import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import { EvmUsdtProvider } from './providers/evm-usdt.provider';
import { TronUsdtProvider } from './providers/tron-usdt.provider';
import { PaymentMatch, PaymentNetwork, PaymentNetworkProvider, SweepResult } from './providers/payment-network.provider.interface';

// Оркестратор: сам не знает деталей конкретной сети, только диспетчеризует
// по карте Record<PaymentNetwork, PaymentNetworkProvider> — та же схема, что
// ChannelsService.providers/TrackingProcessor.providers. BullMQ-мониторинг
// (scheduleMonitoring/stopMonitoring) сетенезависим, поэтому остаётся здесь.
@Injectable()
export class CryptoPaymentService {
  private readonly providers: Record<PaymentNetwork, PaymentNetworkProvider>;

  constructor(
    private config: ConfigService,
    @InjectQueue('payment-monitoring') private queue: Queue,
  ) {
    this.providers = {
      TRC20: new TronUsdtProvider({
        fullHost: this.config.get<string>('TRONGRID_FULL_HOST') || 'https://api.trongrid.org',
        apiKey: this.config.get<string>('TRONGRID_API_KEY'),
        usdtContract: this.config.get<string>('USDT_TRC20_CONTRACT') || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        hdMnemonic: this.config.get<string>('TRON_HD_MNEMONIC'),
        gasPrivateKey: this.config.get<string>('TRON_GAS_PRIVATE_KEY'),
        payoutAddress: this.config.get<string>('OWNER_PAYOUT_ADDRESS_TRC20'),
        gasTrxAmount: Number(this.config.get('SWEEP_GAS_TRX_AMOUNT') || 30),
      }),
      ERC20: new EvmUsdtProvider({
        chainName: 'Ethereum',
        rpcUrl:
          this.config.get<string>('ETH_RPC_URL') ||
          `https://mainnet.infura.io/v3/${this.config.get<string>('INFURA_PROJECT_ID')}`,
        usdtContract: this.config.get<string>('USDT_ERC20_CONTRACT') || '0xdAC17F958D2ee523a2206206994597C13D831ec',
        usdtDecimals: 6,
        explorerApiUrl: this.config.get<string>('ETHERSCAN_API_URL') || 'https://api.etherscan.io/api',
        explorerApiKey: this.config.get<string>('ETHERSCAN_API_KEY'),
        hdMnemonic: this.config.get<string>('ETH_HD_MNEMONIC'),
        gasPrivateKey: this.config.get<string>('ETH_GAS_PRIVATE_KEY'),
        payoutAddress: this.config.get<string>('OWNER_PAYOUT_ADDRESS_EVM'),
        gasNativeAmount: this.config.get<string>('SWEEP_GAS_ETH_AMOUNT') || '0.005',
      }),
      BEP20: new EvmUsdtProvider({
        chainName: 'BSC',
        rpcUrl: this.config.get<string>('BSC_RPC_URL') || 'https://bsc-dataseed.binance.org',
        usdtContract: this.config.get<string>('USDT_BEP20_CONTRACT') || '0x55d398326f99059fF775485246999027B3197955',
        usdtDecimals: 18, // Binance-Peg USDT на BSC — 18 знаков, не 6 (частая ошибка)
        explorerApiUrl: this.config.get<string>('BSCSCAN_API_URL') || 'https://api.bscscan.com/api',
        explorerApiKey: this.config.get<string>('BSCSCAN_API_KEY'),
        hdMnemonic: this.config.get<string>('ETH_HD_MNEMONIC'), // тот же EVM-кошелёк, что и для ERC-20
        gasPrivateKey: this.config.get<string>('BSC_GAS_PRIVATE_KEY'),
        payoutAddress: this.config.get<string>('OWNER_PAYOUT_ADDRESS_EVM'),
        gasNativeAmount: this.config.get<string>('SWEEP_GAS_BNB_AMOUNT') || '0.01',
      }),
    };
  }

  private getProvider(network: PaymentNetwork): PaymentNetworkProvider {
    return this.providers[network];
  }

  generatePaymentAddress(network: PaymentNetwork, invoiceId: string): string {
    return this.getProvider(network).generateAddress(invoiceId);
  }

  async checkTransaction(network: PaymentNetwork, address: string, expectedAmount: number): Promise<PaymentMatch | null> {
    return this.getProvider(network).checkTransaction(address, expectedAmount);
  }

  async sweepToOwner(network: PaymentNetwork, invoiceId: string, address: string, amount: number): Promise<SweepResult> {
    return this.getProvider(network).sweepToOwner(invoiceId, address, amount);
  }

  async scheduleMonitoring(invoiceId: string, expiresAt: Date): Promise<void> {
    await this.queue.add(
      'check-payment',
      { invoiceId },
      { jobId: `invoice-${invoiceId}`, repeat: { every: 15_000, endDate: expiresAt }, removeOnComplete: true },
    );
  }

  async stopMonitoring(invoiceId: string): Promise<void> {
    const repeatableJobs = await this.queue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === `invoice-${invoiceId}`);
    if (job) await this.queue.removeRepeatableByKey(job.key);
  }
}
