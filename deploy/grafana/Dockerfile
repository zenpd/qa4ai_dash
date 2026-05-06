FROM grafana/grafana-oss:10.4.0
# Bake in all dashboard and datasource provisioning
COPY provisioning /etc/grafana/provisioning
# Grafana picks up GF_* env vars at runtime for secrets (API keys, passwords)
