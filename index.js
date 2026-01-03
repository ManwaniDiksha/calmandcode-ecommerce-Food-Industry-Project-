require('dotenv').config();
var express = require('express');
var ejs = require('ejs');
var bodyParser = require('body-parser');
var mysql = require('mysql2');
var session = require('express-session');

// Create connection pool (more efficient than creating connections each time)
var pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'node_project',
    port: 3307,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});

var app = express();

app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ 
    secret: "secret",
    resave: false,
    saveUninitialized: false
}));

app.listen(8081, () => {
    console.log('Server running on http://localhost:8081');
});

// Helper function to check if product is in cart
function isProductInCart(cart, id) {
    for (let i = 0; i < cart.length; i++) {
        if (cart[i].id == id) {
            return true;
        }
    }
    return false;
}

// Helper function to calculate cart total
function calculateTotal(cart, req) {
    let total = 0;
    for (let i = 0; i < cart.length; i++) {
        if (cart[i].sale_price) {
            total = total + (cart[i].sale_price * cart[i].quantity);
        } else {
            total = total + (cart[i].price * cart[i].quantity);
        }
    }
    req.session.total = total;
    return total;
}

// Home page route
app.get('/', function (req, res) {
    pool.query("SELECT * FROM products", (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.render('pages/index', { result: [] });
        }
        res.render('pages/index', { result: result });
    });
});

// Add to cart route
app.post('/add_to_cart', function (req, res) {
    var id = req.body.id;
    var name = req.body.name;
    var price = req.body.price;
    var sale_price = req.body.sale_price;
    var quantity = req.body.quantity;
    var image = req.body.image;

    var product = { 
        id: id, 
        name: name, 
        price: price, 
        sale_price: sale_price, 
        quantity: quantity, 
        image: image 
    };

    if (req.session.cart) {
        var cart = req.session.cart;
        if (!isProductInCart(cart, id)) {
            cart.push(product);
        }
    } else {
        req.session.cart = [product];
        var cart = req.session.cart;
    }

    calculateTotal(cart, req);
    res.redirect('/cart');
});

// Cart page route
app.get('/cart', function (req, res) {
    var cart = req.session.cart || [];
    var total = req.session.total || 0;
    res.render('pages/cart', { cart: cart, total: total });
});

// Remove product from cart
app.post('/remove_product', function (req, res) {
    var id = req.body.id;
    var cart = req.session.cart;

    if (cart) {
        for (let i = 0; i < cart.length; i++) {
            if (cart[i].id == id) {
                cart.splice(i, 1);
                break;
            }
        }
        calculateTotal(cart, req);
    }
    
    res.redirect('/cart');
});

// Edit product quantity
app.post('/edit_product_quantity', function (req, res) {
    var id = req.body.id;
    var increase_btn = req.body.increase_product_quantity;
    var decrease_btn = req.body.decrease_product_quantity;

    var cart = req.session.cart;

    if (cart) {
        if (increase_btn) {
            for (let i = 0; i < cart.length; i++) {
                if (cart[i].id == id) {
                    cart[i].quantity = parseInt(cart[i].quantity) + 1;
                    break;
                }
            }
        }

        if (decrease_btn) {
            for (let i = 0; i < cart.length; i++) {
                if (cart[i].id == id) {
                    if (cart[i].quantity > 1) {
                        cart[i].quantity = parseInt(cart[i].quantity) - 1;
                    }
                    break;
                }
            }
        }

        calculateTotal(cart, req);
    }
    
    res.redirect('/cart');
});

// Checkout page
app.get('/checkout', function (req, res) {
    var total = req.session.total || 0;
    res.render('pages/checkout', { total: total });
});

// Place order
app.post('/place_order', function (req, res) {
    var name = req.body.name;
    var email = req.body.email;
    var phone = req.body.phone;
    var city = req.body.city;
    var address = req.body.address;
    var cost = req.session.total;
    var status = "not paid";
    var date = new Date();
    var products_ids = "";
    var id = Date.now();
    req.session.order_id = id;

    var cart = req.session.cart;

    if (!cart || cart.length === 0) {
        return res.redirect('/cart');
    }

    for (let i = 0; i < cart.length; i++) {
        products_ids = products_ids + "," + cart[i].id;
    }

    var query = "INSERT INTO orders(id, cost, name, email, status, city, address, phone, date, products_ids) VALUES ?";
    var values = [
        [id, cost, name, email, status, city, address, phone, date, products_ids]
    ];

    pool.query(query, [values], (err, result) => {
        if (err) {
            console.error('Order insertion error:', err);
            return res.status(500).send('Failed to place order');
        }

        // Insert order items
        let itemsInserted = 0;
        for (let i = 0; i < cart.length; i++) {
            var itemQuery = "INSERT INTO order_items (order_id, product_id, product_name, product_price, product_image, product_quantity, order_date) VALUES ?";
            var itemValues = [
                [id, cart[i].id, cart[i].name, cart[i].price, cart[i].image, cart[i].quantity, new Date()]
            ];
            
            pool.query(itemQuery, [itemValues], (err, result) => {
                if (err) {
                    console.error('Order item insertion error:', err);
                }
                
                itemsInserted++;
                if (itemsInserted === cart.length) {
                    res.redirect('/payment');
                }
            });
        }
    });
});

// Payment page
app.get('/payment', function (req, res) {
    var total = req.session.total || 0;
    res.render('pages/payment', { 
        total: total, 
        paypalClientId: process.env.PAYPAL_CLIENT_ID 
    });
});

// Verify payment
app.get("/verify_payment", function (req, res) {
    var transaction_id = req.query.transaction_id;
    var order_id = req.session.order_id;

    if (!transaction_id || !order_id) {
        return res.status(400).send('Invalid payment verification');
    }

    var query = "INSERT INTO payments(order_id, transaction_id, date) VALUES ?";
    var values = [
        [order_id, transaction_id, new Date()]
    ];

    pool.query(query, [values], (err, result) => {
        if (err) {
            console.error('Payment insertion error:', err);
            return res.status(500).send('Payment verification failed');
        }

        pool.query("UPDATE orders SET status='paid' WHERE id=?", [order_id], (err, result) => {
            if (err) {
                console.error('Order update error:', err);
            }
            res.redirect('/thank_you');
        });
    });
});

// Thank you page
app.get("/thank_you", function (req, res) {
    var order_id = req.session.order_id;
    res.render("pages/thank_you", { order_id: order_id });
});

// Single product page
app.get('/single_product', function(req, res){
    var id = req.query.id;

    if (!id) {
        return res.redirect('/products');
    }

    pool.query("SELECT * FROM products WHERE id=?", [id], (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.redirect('/products');
        }
        
        if (result.length === 0) {
            return res.redirect('/products');
        }

        res.render('pages/single_product', { result: result });
    });
});

// Products page
app.get('/products', function(req, res){
    pool.query("SELECT * FROM products", (err, result) => {
        if (err) {
            console.error('Database error:', err);
            return res.render('pages/products', { result: [] });
        }
        res.render('pages/products', { result: result });
    });
});

// About page
app.get('/about', function(req, res){
    res.render('pages/about');
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).send('Something went wrong!');
});