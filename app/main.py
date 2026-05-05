import asyncio
import os

from prometheus_client import start_http_server

from app.observability.azure_monitor import AzureConfig, AzureMonitorCollector, _collection_loop as azure_loop
from app.observability.kpi_metrics import SystemMetricsCollector, _collection_loop as system_loop
from app.observability.phoenix import PhoenixConfig, PhoenixMetricsCollector, _collection_loop as phoenix_loop
from app.observability.temporal import TemporalConfig, TemporalMetricsCollector, _collection_loop as temporal_loop
from app.observability.tracing import setup_tracing
from app.shared.logger import logger


async def _main() -> None:
    setup_tracing()

    metrics_port = int(os.environ.get("METRICS_PORT", "8001"))
    start_http_server(metrics_port)
    logger.info("Prometheus metrics server started on port %d", metrics_port)

    system_collector = SystemMetricsCollector()
    phoenix_config = PhoenixConfig.from_env()
    phoenix_collector = PhoenixMetricsCollector(phoenix_config)
    temporal_config = TemporalConfig.from_env()
    temporal_collector = TemporalMetricsCollector(temporal_config)
    azure_config = AzureConfig.from_env()
    azure_collector = AzureMonitorCollector(azure_config)

    logger.info("System metrics collector scheduled")
    logger.info("Phoenix metrics collector scheduled, target: %s", phoenix_config.base_url)
    logger.info("Temporal metrics collector scheduled, target: %s / ns: %s", temporal_config.base_url, temporal_config.namespaces)
    logger.info("Azure Monitor collector scheduled, sub: %s rg: %s token_file: %s",
                azure_config.subscription_id, azure_config.resource_group, azure_config.token_file)

    await asyncio.gather(
        system_loop(system_collector),
        phoenix_loop(phoenix_collector),
        temporal_loop(temporal_collector),
        azure_loop(azure_collector),
    )


if __name__ == "__main__":
    asyncio.run(_main())
