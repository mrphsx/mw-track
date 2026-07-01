import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import { ethers } from 'ethers';
import { PaymentMatch, PaymentNetworkProvider, SweepResult } from './payment-network.provider.interface';

export interface EvmProviderConfig {
  chainName: string; // только для логов/сообщений об ошибках, напр. "Ethereum"/"BSC"
  rpcUrl: string;
  usdtContract: string;
  usdtDecimals: number; // 6 на Ethereum mainnet, НО 18 у Binance-Peg USDT на BSC — это не баг
  explorerApiUrl: string; // Etherscan/BscScan-совместимый "tokentx" эндпоинт
  explorerApiKey?: string;
  hdMnemonic?: string; // ETH_HD_MNEMONIC — один и тот же EVM-кошелёк работает на любой EVM-сети
  gasPrivateKey?: string;
  payoutAddress?: string;
  gasNativeAmount: string; // в эфирных единицах (ETH/BNB), напр. "0.01"
}

// Не @Injectable() — у Ethereum и BSC идентичная механика (тот же ethers.js, тот же
// формат адреса/деривации secp256k1), различаются только RPC/контракт/decimals/газ.
// Вместо двух почти одинаковых NestJS-провайдеров CryptoPaymentService создаёт два
// экземпляра этого класса с разным конфигом — добавить полигон/арбитрум = третий конфиг,
// не новый класс.
export class EvmUsdtProvider implements PaymentNetworkProvider {
  private readonly logger = new Logger(EvmUsdtProvider.name);
  private readonly provider: ethers.JsonRpcProvider;

  constructor(private readonly config: EvmProviderConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  generateAddress(invoiceId: string): string {
    return this.deriveWallet(invoiceId).address;
  }

  private deriveWallet(invoiceId: string): ethers.HDNodeWallet {
    if (!this.config.hdMnemonic) {
      throw new Error(`${this.config.chainName}: ETH_HD_MNEMONIC не задан в .env — генерация адреса невозможна`);
    }
    const index = this.deriveIndex(invoiceId);
    return ethers.HDNodeWallet.fromPhrase(this.config.hdMnemonic, undefined, `m/44'/60'/0'/0/${index}`);
  }

  private deriveIndex(invoiceId: string): number {
    const hash = crypto.createHash('sha256').update(invoiceId).digest('hex');
    return parseInt(hash.slice(0, 8), 16) % 0x7fffffff;
  }

  // Etherscan/BscScan "tokentx" — список ERC20-трансферов адреса по конкретному контракту,
  // совпадает по структуре с TronGrid-эндпоинтом, который уже используется для TRC-20.
  async checkTransaction(address: string, expectedAmount: number): Promise<PaymentMatch | null> {
    const params = new URLSearchParams({
      module: 'account',
      action: 'tokentx',
      contractaddress: this.config.usdtContract,
      address,
      sort: 'desc',
      ...(this.config.explorerApiKey ? { apikey: this.config.explorerApiKey } : {}),
    });
    const url = `${this.config.explorerApiUrl}?${params.toString()}`;

    let body: { status?: string; result?: Array<{ to: string; value: string; hash: string }> };
    try {
      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`${this.config.chainName} explorer вернул ${res.status} для ${address}`);
        return null;
      }
      body = await res.json();
    } catch (error) {
      this.logger.warn(`Запрос к ${this.config.chainName} explorer не удался для ${address}: ${(error as Error).message}`);
      return null;
    }

    for (const tx of body.result || []) {
      if (tx.to?.toLowerCase() !== address.toLowerCase()) continue; // в ответе вместе входящие и исходящие
      const amount = Number(tx.value) / 10 ** this.config.usdtDecimals;
      // допускаем недоплату до 1% — конвертация/комиссии на стороне плательщика округляют сумму
      if (amount >= expectedAmount * 0.99) {
        return { txHash: tx.hash, amount };
      }
    }
    return null;
  }

  // Тот же двухшаговый свип, что и в TronUsdtProvider: адрес инвойса свежедеривирован
  // и не имеет нативного газа (ETH/BNB) — без него ERC20-трансфер невозможен.
  // 1) газовый кошелёк присылает немного нативной монеты на адрес инвойса
  // 2) с адреса инвойса весь USDT уходит на payoutAddress
  async sweepToOwner(invoiceId: string, address: string, usdtAmount: number): Promise<SweepResult> {
    if (!this.config.gasPrivateKey || !this.config.payoutAddress) {
      throw new Error(`${this.config.chainName}: газовый кошелёк/адрес получателя не настроены — свип отключён`);
    }

    const gasWallet = new ethers.Wallet(this.config.gasPrivateKey, this.provider);
    const fundTx = await gasWallet.sendTransaction({ to: address, value: ethers.parseEther(this.config.gasNativeAmount) });
    await fundTx.wait();

    const invoiceWallet = this.deriveWallet(invoiceId).connect(this.provider);
    const usdt = new ethers.Contract(this.config.usdtContract, ['function transfer(address,uint256) returns (bool)'], invoiceWallet);
    const amountUnits = BigInt(Math.round(usdtAmount * 10 ** this.config.usdtDecimals));
    const tx = await usdt.transfer(this.config.payoutAddress, amountUnits);
    await tx.wait();

    return { txHash: tx.hash };
  }
}
