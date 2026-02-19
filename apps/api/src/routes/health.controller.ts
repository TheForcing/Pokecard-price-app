import { Controller, Get, Header, Inject } from '@nestjs/common';
import { PriceService } from '../services/price.service.js';

@Controller('/health')
export class HealthController {
  private readonly priceService: PriceService;

  constructor(@Inject(PriceService) priceService: PriceService) {
    this.priceService = priceService;
  }

  private formatPrometheusMetrics(): string {
    const rawSnapshot =
      typeof this.priceService.getMetricsSnapshot === 'function'
        ? this.priceService.getMetricsSnapshot()
        : undefined;
    const snapshot =
      rawSnapshot &&
      typeof rawSnapshot === 'object' &&
      'cache' in rawSnapshot &&
      'providers' in rawSnapshot
        ? rawSnapshot
        : {
            cache: {
              redis: { hit: 0, miss: 0, set: 0, read_error: 0, write_error: 0 },
              memory: { hit: 0, miss: 0, set: 0, read_error: 0, write_error: 0 },
            },
            providers: [],
          };
    const lines: string[] = [];

    lines.push('# HELP pokecard_cache_events_total Cache event counts by cache tier and action');
    lines.push('# TYPE pokecard_cache_events_total counter');
    for (const cache of ['redis', 'memory'] as const) {
      for (const action of ['hit', 'miss', 'set', 'read_error', 'write_error'] as const) {
        lines.push(
          `pokecard_cache_events_total{cache="${cache}",action="${action}"} ${snapshot.cache[cache][action]}`,
        );
      }
    }

    lines.push('# HELP pokecard_provider_calls_total Provider call result counts');
    lines.push('# TYPE pokecard_provider_calls_total counter');
    lines.push('# HELP pokecard_provider_circuit_open_total Provider circuit open event counts');
    lines.push('# TYPE pokecard_provider_circuit_open_total counter');
    lines.push('# HELP pokecard_provider_latency_ms Provider latency summary in milliseconds');
    lines.push('# TYPE pokecard_provider_latency_ms gauge');

    for (const provider of snapshot.providers) {
      lines.push(
        `pokecard_provider_circuit_open_total{provider="${provider.provider}"} ${provider.circuitOpenCount}`,
      );
      for (const [result, count] of Object.entries(provider.results)) {
        lines.push(
          `pokecard_provider_calls_total{provider="${provider.provider}",result="${result}"} ${count}`,
        );
      }
      lines.push(
        `pokecard_provider_latency_ms{provider="${provider.provider}",stat="avg"} ${provider.latencyMs.avg}`,
      );
      lines.push(
        `pokecard_provider_latency_ms{provider="${provider.provider}",stat="p95"} ${provider.latencyMs.p95}`,
      );
      lines.push(
        `pokecard_provider_latency_ms{provider="${provider.provider}",stat="p99"} ${provider.latencyMs.p99}`,
      );
      lines.push(
        `pokecard_provider_latency_ms{provider="${provider.provider}",stat="max"} ${provider.latencyMs.max}`,
      );
    }

    return `${lines.join('\n')}\n`;
  }

  @Get()
  health() {
    return { ok: true, service: 'api', time: new Date().toISOString() };
  }

  @Get('metrics')
  metrics() {
    return {
      ok: true,
      service: 'api',
      time: new Date().toISOString(),
      note: 'in-memory counters reset on process restart',
      ...this.priceService.getMetricsSnapshot(),
    };
  }

  @Get('metrics/prometheus')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metricsPrometheus() {
    return this.formatPrometheusMetrics();
  }
}
