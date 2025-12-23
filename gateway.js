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

// Invalidate cache entries for a specific book ID
function invalidateBookCache(bookId) {
    const keysToDelete = [];
    
    for (const key of cache.keys()) {
        // Invalidate direct info endpoint
        if (key === `/books/info/${bookId}` || key.startsWith(`/books/info/${bookId}?`)) {
            keysToDelete.push(key);
            continue;
        }
        
        // Invalidate search results that might contain this book
        if (key.startsWith('/books/search/')) {
            const cachedData = cache.get(key);
            if (Array.isArray(cachedData)) {
                const hasBook = cachedData.some(book => book.id === bookId);
                if (hasBook) {
                    keysToDelete.push(key);
                }
            }
        }
    }
    
    keysToDelete.forEach(key => cache.delete(key));
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

// Cache invalidation endpoint (called by backend services before writes)
app.post('/cache/invalidate', (req, res) => {
    const { bookId } = req.body;
    
    if (!bookId) {
        return res.status(400).json({ message: 'bookId is required' });
    }
    
    invalidateBookCache(parseInt(bookId));
    res.json({ message: 'Cache invalidated successfully', bookId });
});

app.use('/books', (req, res, next) => {
    const cacheKey = req.originalUrl || req.url;
    
    // Handle write requests (PATCH, POST, PUT) - forward without caching
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
    
    // Handle read requests (GET) - check cache first
    if (req.method === 'GET') {
        // Check if this is a cacheable endpoint (search or info)
        const originalPath = req.originalUrl || req.url;
        const isSearch = originalPath.includes('/search/');
        const isInfo = originalPath.includes('/info/');
        
        if (isSearch || isInfo) {
            // Check cache
            if (cache.has(cacheKey)) {
                const cachedData = cache.get(cacheKey);
                return res.json(cachedData);
            }
            
            // Cache miss - forward request
            const target = getNextCatalogService();
            const targetUrl = new URL(target);
            
            const proxyReq = http.request({
                hostname: targetUrl.hostname,
                port: targetUrl.port || 8080,
                path: req.originalUrl || req.url,
                method: 'GET'
            }, (proxyRes) => {
                let responseData = '';
                
                proxyRes.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                proxyRes.on('end', () => {
                    try {
                        if (proxyRes.statusCode === 200) {
                            const data = JSON.parse(responseData);
                            
                            // Extract and cache book data
                            if (isInfo && data) {
                                const cachedBook = extractBookData(data);
                                cache.set(cacheKey, cachedBook);
                            } else if (isSearch && Array.isArray(data)) {
                                const cachedBooks = data.map(book => extractBookData(book));
                                cache.set(cacheKey, cachedBooks);
                            }
                        }
                        
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(responseData);
                    } catch (err) {
                        res.writeHead(proxyRes.statusCode, proxyRes.headers);
                        res.end(responseData);
                    }
                });
            });
            
            proxyReq.on('error', () => {
                res.status(503).json({ message: 'Catalog service unavailable' });
            });
            
            proxyReq.end();
            return;
        }
    }
    
    // Non-cacheable requests - forward normally
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

