# Bazar Gateway Service

Gateway service for routing requests to catalog and order microservices.

## Features

- Routes `/books/*` requests to Catalog Service
- Routes `/purchase/*` requests to Order Service
- Handles PATCH, POST, and PUT requests with JSON bodies
- CORS enabled
- Error handling for service unavailability

## Usage

```bash
npm install
npm start
```

## Environment Variables

- `PORT` - Gateway port (default: 3000)
- `CATALOG_SERVICE_URL` - Catalog service URL (default: http://catalog-service:8080)
- `ORDER_SERVICE_URL` - Order service URL (default: http://order-service:8080)

