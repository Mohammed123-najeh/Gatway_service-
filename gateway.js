const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://catalog-service:8080';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:8080';

app.use(cors());
app.use(express.json());

app.use('/books', (req, res, next) => {
    if ((req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') && req.body) {
        const bodyData = JSON.stringify(req.body);
        const targetUrl = new URL(CATALOG_SERVICE_URL);
        const proxyReq = http.request({
            hostname: targetUrl.hostname,
            port: targetUrl.port || 8080,
            path: req.originalUrl || req.url,
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyData)
            }
        }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });
        
        proxyReq.on('error', () => {
            res.status(503).json({ message: 'Catalog service unavailable' });
        });
        
        proxyReq.write(bodyData);
        proxyReq.end();
        return;
    }
    next();
}, createProxyMiddleware({
    target: CATALOG_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
        '^/books': '/books'
    },
    onError: (err, req, res) => {
        res.status(503).json({ message: 'Catalog service unavailable' });
    }
}));

app.use('/purchase', createProxyMiddleware({
    target: ORDER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: {
        '^/purchase': '/purchase'
    },
    onError: (err, req, res) => {
        res.status(503).json({ message: 'Order service unavailable' });
    }
}));

app.get('/', (req, res) => {
    res.json({
        message: 'Bazar Gateway Service',
        endpoints: {
            catalog: '/books/*',
            order: '/purchase/*'
        }
    });
});

app.use((req, res) => {
    res.status(404).json({ 
        message: 'Route not found',
        path: req.path 
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gateway service running on port ${PORT}`);
    console.log(`Catalog Service: ${CATALOG_SERVICE_URL}`);
    console.log(`Order Service: ${ORDER_SERVICE_URL}`);
});

