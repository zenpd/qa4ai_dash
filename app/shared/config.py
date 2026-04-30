from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    temporal_host: str = Field(default="localhost:7233")
    temporal_namespace: str = Field(default="default")

    phoenix_host: str = Field(default="http://localhost:6006")

    azure_subscription_id: str = Field(default="")
    azure_tenant_id: str = Field(default="")
    azure_client_id: str = Field(default="")
    azure_client_secret: str = Field(default="")
    azure_resource_group: str = Field(default="")
    azure_openai_resource: str = Field(default="")

    app_port: int = Field(default=8000)

    model_config = {"env_file": ".env"}


settings = Settings()
