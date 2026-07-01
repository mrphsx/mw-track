import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { TronWeb } from 'tronweb';
import { PaymentMatch, PaymentNetworkProvider, SweepResult } from './payment-network.provider.interface';

const bip32 = BIP32Factory(ecc);

export interface TronProviderConfig {
  fullHost: string;
  apiKey?: string;
  usdtContract: string;
  hdMnemonic?: string;
  gasPrivateKey?: string;
  payoutAddress?: string;
  gasTrxAmount: number;
}

// Не @Injectable() — конструируется напрямую CryptoPaymentService с уже разрешённым
// конфигом (см. "почему" в evm-usdt.provider.ts, тот же резон тут не так выражен,
// но оставлен для единообразия дальнейших сетей).
export class TronUsdtProvider implements PaymentNetworkProvider {
  private readonly logger = new Logger(TronUsdtProvider.name);
  private readonly tronWeb: TronWeb;

  constructor(private readonly config: TronProviderConfig) {
    this.tronWeb = new TronWeb({
      fullHost: config.fullHost,
      headers: config.apiKey ? { 'TRON-PRO-API-KEY': config.apiKey } : undefined,
    });
  }

  // Один адрес на инвойс, выведенный детерминированно из invoiceId — в Invoice нет
  // поля под индекс деривации, поэтому индекс не хранится, а пересчитывается каждый раз
  // одинаково. Приватный ключ существует только внутри этого вызова, никуда не пишется.
  generateAddress(invoiceId: string): string {
    const privateKey = this.derivePrivateKey(invoiceId);
    const address = this.tronWeb.address.fromPrivateKey(privateKey);
    if (!address) throw new Error('TronWeb не смог вычислить адрес из приватного ключа');
    return address;
  }

  private derivePrivateKey(invoiceId: string): string {
    if (!this.config.hdMnemonic) {
      throw new Error('TRON_HD_MNEMONIC не задан в .env — генерация адреса невозможна');
    }
    const seed = bip39.mnemonicToSeedSync(this.config.hdMnemonic);
    const root = bip32.fromSeed(seed);
    const index = this.deriveIndex(invoiceId);
    const child = root.derivePath(`m/44'/195'/0'/0/${index}`);
    if (!child.privateKey) throw new Error('Не удалось вывести приватный ключ');
    return Buffer.from(child.privateKey).toString('hex');
  }

  private deriveIndex(invoiceId: string): number {
    const hash = crypto.createHash('sha256').update(invoiceId).digest('hex');
    return parseInt(hash.slice(0, 8), 16) % 0x7fffffff;
  }

  // TronGrid: TRC20-трансферы контракта USDT на конкретный адрес. Сумма в ответе —
  // целые unit'ы контракта (USDT TRC-20 имеет 6 знаков), делим на 1e6.
  async checkTransaction(address: string, expectedAmount: number): Promise<PaymentMatch | null> {
    const url = `https://api.trongrid.org/v1/accounts/${address}/transactions/trc20?contract_address=${this.config.usdtContract}&limit=20`;

    let body: { data?: Array<{ to: string; value: string; transaction_id: string }> };
    try {
      const res = await fetch(url, this.config.apiKey ? { headers: { 'TRON-PRO-API-KEY': this.config.apiKey } } : undefined);
      if (!res.ok) {
        this.logger.warn(`TronGrid вернул ${res.status} для ${address}`);
        return null;
      }
      body = await res.json();
    } catch (error) {
      // TronGrid временно недоступен/нет сети — не повод ронять запрос 500:
      // платёж просто не подтверждён в эту попытку, следующий repeatable job/крон попробует снова.
      this.logger.warn(`Запрос к TronGrid не удался для ${address}: ${(error as Error).message}`);
      return null;
    }

    for (const tx of body.data || []) {
      if (tx.to !== address) continue; // в ответе вместе входящие и исходящие трансферы
      const amount = Number(tx.value) / 1e6;
      // допускаем недоплату до 1% — конвертация/комиссии на стороне плательщика округляют сумму
      if (amount >= expectedAmount * 0.99) {
        return { txHash: tx.transaction_id, amount };
      }
    }
    return null;
  }

  // Адрес инвойса свежедеривирован и не имеет TRX — TRC-20 трансфер требует energy,
  // покупаемой за TRX, поэтому без газа сам адрес ничего перевести не может.
  // Шаг 1: отдельный газовый кошелёк (TRON_GAS_PRIVATE_KEY, не из HD-мнемоники
  // инвойсов — изолирован специально) присылает немного TRX на адрес инвойса.
  // Шаг 2: с адреса инвойса (подписываем приватным ключом, выведенным из invoiceId —
  // тем же путём, что и при генерации адреса) переводим весь полученный USDT
  // на payoutAddress. Остаток TRX на адресе инвойса не возвращается — известное
  // упрощение MVP (см. 10_BACKEND_BILLING.md), не баг.
  async sweepToOwner(invoiceId: string, paymentAddress: string, usdtAmount: number): Promise<SweepResult> {
    if (!this.config.gasPrivateKey || !this.config.payoutAddress) {
      throw new Error('TRON_GAS_PRIVATE_KEY/OWNER_PAYOUT_ADDRESS_TRC20 не настроены — свип отключён');
    }
    const gasAmountSun = this.config.gasTrxAmount * 1_000_000;

    const gasTronWeb = new TronWeb({ fullHost: this.config.fullHost, privateKey: this.config.gasPrivateKey });
    const fundTx = await gasTronWeb.trx.sendTransaction(paymentAddress, gasAmountSun);
    if (!fundTx?.result) {
      throw new Error(`Не удалось перевести TRX на газ для ${paymentAddress}: ${JSON.stringify(fundTx)}`);
    }

    // TRON блок ~3с — ждём, чтобы перевод газа точно учёлся в балансе перед следующей транзакцией
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const invoicePrivateKey = this.derivePrivateKey(invoiceId);
    const senderTronWeb = new TronWeb({ fullHost: this.config.fullHost, privateKey: invoicePrivateKey });
    const contract = await senderTronWeb.contract().at(this.config.usdtContract);
    const txHash: string = await contract.transfer(this.config.payoutAddress, Math.round(usdtAmount * 1e6)).send({
      feeLimit: 50_000_000, // 50 TRX максимум — защита от непредсказуемо высокой комиссии за энергию
    });

    return { txHash };
  }
}
