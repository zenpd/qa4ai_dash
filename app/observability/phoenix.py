import asyncio
import os
from dataclasses import dataclass

import httpx
from prometheus_client import Gauge

from app.shared.logger import logger

_COLLECTION_INTERVAL = 30

# Model performance
_accuracy = Gauge("phoenix_model_accuracy", "Model accuracy", ["model_name"])
_precision = Gauge("phoenix_model_precision", "Model precision", ["model_name"])
_recall = Gauge("phoenix_model_recall", "Model recall", ["model_name"])
_f1_score = Gauge("phoenix_model_f1_score", "Model F1 score", ["model_name"])
_drift_score = Gauge("phoenix_model_drift_score", "Model drift score", ["model_name"])
_calibration_error = Gauge("phoenix_model_calibration_error", "Model calibration error", ["model_name"])

# Data quality
_feature_drift = Gauge("phoenix_feature_drift", "Feature drift score", ["model_name", "feature"])
_outlier_count = Gauge("phoenix_outlier_count", "Outlier count", ["model_name"])
_bias_score = Gauge("phoenix_bias_score", "Bias score", ["model_name", "slice"])

# User feedback
_positive_feedback = Gauge("phoenix_positive_feedback_count", "Positive feedback count", ["model_name"])
_negative_feedback = Gauge("phoenix_negative_feedback_count", "Negative feedback count", ["model_name"])
_annotation_count = Gauge("phoenix_annotation_count", "Annotation count", ["model_name"])
_retraining_trigger_count = Gauge("phoenix_retraining_trigger_count", "Retraining trigger count", ["model_name"])

# Explainability
_feature_importance = Gauge("phoenix_feature_importance", "Feature importance score", ["model_name", "feature"])
_counterfactual_count = Gauge("phoenix_counterfactual_count", "Counterfactual count", ["model_name"])
_sensitive_feature_score = Gauge(
    "phoenix_sensitive_feature_score", "Sensitive feature score", ["model_name", "feature"]
)


@dataclass
class PhoenixConfig:
    base_url: str

    @classmethod
    def from_env(cls) -> "PhoenixConfig":
        return cls(base_url=os.environ.get("PHOENIX_BASE_URL", "http://localhost:6006"))


class PhoenixMetricsCollector:
    def __init__(self, config: PhoenixConfig) -> None:
        self._base_url = config.base_url.rstrip("/")

    async def _get(self, client: httpx.AsyncClient, path: str) -> dict | list | None:
        try:
            response = await client.get(f"{self._base_url}{path}", timeout=10.0)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.warning("Phoenix API call failed: %s — %s", path, exc)
            return None

    async def collect(self) -> None:
        async with httpx.AsyncClient() as client:
            await self._collect_model_performance(client)
            await self._collect_data_quality(client)
            await self._collect_user_feedback(client)
            await self._collect_explainability(client)

    async def _collect_model_performance(self, client: httpx.AsyncClient) -> None:
        data = await self._get(client, "/v1/model/performance")
        if not isinstance(data, dict):
            return

        for model_name, metrics in data.items():
            if not isinstance(metrics, dict):
                continue
            _accuracy.labels(model_name=model_name).set(metrics.get("accuracy", 0))
            _precision.labels(model_name=model_name).set(metrics.get("precision", 0))
            _recall.labels(model_name=model_name).set(metrics.get("recall", 0))
            _f1_score.labels(model_name=model_name).set(metrics.get("f1_score", 0))
            _drift_score.labels(model_name=model_name).set(metrics.get("drift_score", 0))
            _calibration_error.labels(model_name=model_name).set(metrics.get("calibration_error", 0))

    async def _collect_data_quality(self, client: httpx.AsyncClient) -> None:
        data = await self._get(client, "/v1/model/data_quality")
        if not isinstance(data, dict):
            return

        for model_name, metrics in data.items():
            if not isinstance(metrics, dict):
                continue
            _outlier_count.labels(model_name=model_name).set(metrics.get("outlier_count", 0))

            for feature, drift in metrics.get("feature_drift", {}).items():
                _feature_drift.labels(model_name=model_name, feature=feature).set(drift)

            for slice_name, score in metrics.get("bias_scores", {}).items():
                _bias_score.labels(model_name=model_name, slice=slice_name).set(score)

    async def _collect_user_feedback(self, client: httpx.AsyncClient) -> None:
        data = await self._get(client, "/v1/model/feedback")
        if not isinstance(data, dict):
            return

        for model_name, metrics in data.items():
            if not isinstance(metrics, dict):
                continue
            _positive_feedback.labels(model_name=model_name).set(metrics.get("positive", 0))
            _negative_feedback.labels(model_name=model_name).set(metrics.get("negative", 0))
            _annotation_count.labels(model_name=model_name).set(metrics.get("annotations", 0))
            _retraining_trigger_count.labels(model_name=model_name).set(
                metrics.get("retraining_triggers", 0)
            )

    async def _collect_explainability(self, client: httpx.AsyncClient) -> None:
        data = await self._get(client, "/v1/model/explainability")
        if not isinstance(data, dict):
            return

        for model_name, metrics in data.items():
            if not isinstance(metrics, dict):
                continue
            _counterfactual_count.labels(model_name=model_name).set(
                metrics.get("counterfactual_count", 0)
            )

            for feature, importance in metrics.get("feature_importance", {}).items():
                _feature_importance.labels(model_name=model_name, feature=feature).set(importance)

            for feature, score in metrics.get("sensitive_feature_scores", {}).items():
                _sensitive_feature_score.labels(model_name=model_name, feature=feature).set(score)


async def _collection_loop(collector: PhoenixMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Phoenix metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)


