const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const http = require('http');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const CATALOG_SERVICE_URLS = (process.env.CATALOG_SERVICE_URLS || 'http://catalog-service-1:8080,http://catalog-service-2:8080').split(',').map(url => url.trim());
const ORDER_SERVICE_URLS = (process.env.ORDER_SERVICE_URLS || 'http://order-service-1:8080,http://order-service-2:8080').split(',').map(url => url.trim());

let catalogIndex = 0;
let orderIndex = 0;

// In-memory cache for read requests
const cache = new Map();

// Extract cacheable book data (id, title, price, quantity)
function extractBookData(book) {
    return {
        id: book.id || book.Id,
        title: book.bookName || book.BookName,
        price: book.cost || book.Cost,
        quantity: book.numberOfItems || book.NumberOfItems
    };
}

function getNextCatalogService() {
    const url = CATALOG_SERVICE_URLS[catalogIndex % CATALOG_SERVICE_URLS.length];
    catalogIndex = (catalogIndex + 1) % CATALOG_SERVICE_URLS.length;
    return url;
}

function getNextOrderService() {
    const url = ORDER_SERVICE_URLS[orderIndex % ORDER_SERVICE_URLS.length];
    orderIndex = (orderIndex + 1) % ORDER_SERVICE_URLS.length;
    return url;
}

app.use(cors());
app.use(express.json());

app.use('/books', (req, res, next) => {
    if ((req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') && req.body) {
        const bodyData = JSON.stringify(req.body);
        const targetUrl = new URL(getNextCatalogService());
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
}, (req, res, next) => {
    const target = getNextCatalogService();
    return createProxyMiddleware({
        target: target,
    changeOrigin: true,
    pathRewrite: {
        '^/books': '/books'
    },
    onError: (err, req, res) => {
        res.status(503).json({ message: 'Catalog service unavailable' });
    }
    })(req, res, next);
});

app.use('/purchase', (req, res, next) => {
    const target = getNextOrderService();
    return createProxyMiddleware({
        target: target,
    changeOrigin: true,
    pathRewrite: {
        '^/purchase': '/purchase'
    },
    onError: (err, req, res) => {
        res.status(503).json({ message: 'Order service unavailable' });
    }
    })(req, res, next);
});

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
    console.log(`Catalog Services: ${CATALOG_SERVICE_URLS.join(', ')}`);
    console.log(`Order Services: ${ORDER_SERVICE_URLS.join(', ')}`);
});

