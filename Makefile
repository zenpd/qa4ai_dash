.PHONY: up down logs restart build

up:
	docker-compose up -d

down:
	docker-compose down

build:
	docker-compose build --no-cache

logs:
	docker-compose logs -f

restart:
	docker-compose down && docker-compose up -d

grafana:
	open http://localhost:3000

api-docs:
	open http://localhost:8000/docs
