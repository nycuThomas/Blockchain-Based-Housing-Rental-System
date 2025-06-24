const path = require('path')
const express = require('express');
const fileUpload = require("express-fileupload");
const flash = require('connect-flash');
const session = require('express-session');
const passport = require('passport');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');

const app = express();

// setup DB
const db1 = require('./config/keys').GovernmentDB_URI;
const db1Connection = mongoose.createConnection(db1);
db1Connection.once('open', () => {
    console.log('\x1b[35m%s\x1b[0m', '--------------------Database information-------------------');
    console.log('\x1b[35m%s\x1b[0m', `${db1Connection.name}'s           DB connected by DID`);
});


// Body parser
app.use(express.urlencoded({ extended: false }));

// Express session
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: false,
}));

// Connect flash
app.use(flash());

// Global Vars
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msh');
    next();
});


app.use(passport.initialize());
app.use(passport.session());
app.use(fileUpload());

passport.serializeUser(function (user, done) {
    done(null, user);
});

passport.deserializeUser(function (user, done) {
    done(null, user);
});

//EJS 
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/contracts', express.static(__dirname + '/contracts/identityChain/'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


// Routes
app.use('/identityChain', require('./routes/identityChain/identityChain')(db1Connection));
app.use('/leaseSystem', require('./routes/leaseSystem'));

const PORT = process.env.PORT || 3000;
app.listen(PORT);
module.exports = app;