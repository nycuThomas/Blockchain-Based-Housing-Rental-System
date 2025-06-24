const express = require('express');
const fs = require('fs');
const path = require('path')
const { Web3 } = require('web3');

// session
const passport = require('passport');
const LocalStrategy = require('passport-local');

// tool
const router = express.Router();
var config = JSON.parse(fs.readFileSync('./config/server_config.json', 'utf-8'));
const identityManger = JSON.parse(fs.readFileSync('./contracts/identityChain/IdentityManager.json', 'utf-8'));
var contract_address = config.contracts.identityManagerAddress;
const keccak256 = require('keccak256');
const web3 = new Web3(new Web3.providers.HttpProvider(config.web3_provider));





var require_signature = 'DID';

module.exports = function (dbconnection) {
    // User and Org model (mongoose)
    const User = dbconnection.model('users', require('../../models/government/user'));
    const Organization = dbconnection.model('orgs', require('../../models/government/organization'));

    router.get('/', async (req, res) => {
        // if (dbconnection.readyState === 1) {

        //     console.log('Database connected:', dbconnection.db.databaseName);
        //     const collections = await dbconnection.db.listCollections().toArray();
        //     const collectionNames = collections.map(collection => collection.name);
        //     console.log('Collections:', collectionNames);

        //     // dbconnection.model('users', require('../../models/user'));
        //     let users = await dbconnection.model('users').find({});
        //     console.log('Users:', users);


        // } else {
        //     console.log('Database not connected');
        // }
        res.render('identityChain/homepage', { 'contract_address': contract_address, 'require_signature': require_signature, 'info': req.flash('info') });
    });

    router.get('/register', (req, res) => res.render('identityChain/register.ejs', { "info": req.flash('info') }));

    var isAuthenticated = function (req, res, next) {
        if (req.isAuthenticated()) {
            next();
        } else {
            req.flash('info', 'Login first.');
            res.redirect('/identityChain');
        }
    };

    passport.use('user', new LocalStrategy(
        {
            usernameField: 'userName',
            passwordField: 'IDNumber',
            passReqToCallback: true
        },
        async function (req, userName, IDNumber, done) {
            let option = {
                'IDNumber': IDNumber,
                'userName': userName
            }
            let user = await User.findOne(option);


            if (user) {
                return done(null, { "identity": user.hashed, "type": "user" });
            }
            else {
                req.flash('info', 'User is not exist.');

                return done(null, false)
            }
        }
    ));
    passport.use('org', new LocalStrategy(
        {
            usernameField: 'organizationName',
            passwordField: 'uniformNumber',
            passReqToCallback: true
        },
        async function (req, organizationName, uniformNumber, done) {
            let option = {
                'organizationName': organizationName,
                'UniformNumbers': uniformNumber
            }
            let organization = await Organization.findOne(option);
            if (organization) {
                return done(null, { "identity": organization.hashed, "type": "org" });
            }
            else {
                req.flash('info', 'Org is not exist.');
                return done(null, false)
            }
        }
    ));
    passport.use('verifySign_DID', new LocalStrategy({
        usernameField: 'account',
        passwordField: 'signature',
        passReqToCallback: true
    },
        async function (req, username, password, done) {
            let account = username.toLowerCase(); //address
            let signature = password;
            signingAccount = web3.eth.accounts.recover(require_signature, signature).toLowerCase();


            if (signingAccount == account) {
                return done(null, { "address": account });
            }
            else {
                return done(null, false);
            }
        }
    ));

    // register POST handler 
    router.post('/USERregister', async (req, res) => {
        // console.log(req.body);
        const { userName, birth, email, phone, IDNumber } = req.body;
        let errors = [];

        // Validation IDNumber are unique
        await User.findOne({ IDNumber, IDNumber })
            .then(user => {
                if (user) {
                    errors.push('IDNumber already exist in DB');
                    console.log(errors);
                    // User exist
                    res.render('identityChain/register', {
                        errors,
                        userName,
                        birth,
                        email,
                        phone,
                        IDNumber
                    });
                } else {
                    const newUser = new User({
                        userName,
                        birth,
                        email,
                        phone,
                        IDNumber
                    });
                    // console.log(NewUser);
                    // res.send('register OK');


                    let hashed = keccak256(IDNumber).toString('hex');
                    newUser.hashed = hashed;

                    newUser.save()
                        .then(user => {
                            req.flash('success_msg', 'You are now register and can log in');
                            res.redirect('/identityChain');
                        })
                        .catch(err => console.log(err));

                }
            });
    });



    router.post('/ORGregister', async (req, res) => {
        // console.log(req.body);
        const { organizationName, personInCharge, email, phone, UniformNumbers, type } = req.body;
        let errors = [];

        // Validation IDNumber are unique
        await Organization.findOne({ UniformNumbers, UniformNumbers })
            .then(org => {
                if (org) {
                    errors.push('UniformNumbers already exist in DB');
                    console.log(errors);
                    // Org exist
                    res.render('identityChain/register', {
                        errors,
                        organizationName,
                        personInCharge,
                        email,
                        phone,
                        UniformNumbers,
                        type
                    });
                } else {
                    const newOrg = new Organization({
                        organizationName,
                        personInCharge,
                        email,
                        phone,
                        UniformNumbers,
                        type
                    })
                    // console.log(NewUser);
                    // res.send('register OK');


                    let hashed = keccak256(UniformNumbers + 'DCSLAB').toString('hex');
                    newOrg.hashed = hashed;

                    newOrg.save()
                        .then(org => {
                            res.redirect('/identityChain');
                        })
                        .catch(err => console.log(err));

                }
            });
    });
    router.get('/profile', isAuthenticated, async function (req, res) {
        let option = {
            $or: [
                { 'hashed': req.user.identity },
                { 'address': req.user.address } // Metamask login
            ]
        };
        let user;
        let portfolioOrg;
        let type = req.user.type;
        if (req.user.type == "org") { // 
            user = await Organization.findOne(option)
        } else if (req.user.type == 'user') {
            user = await User.findOne(option);
            portfolioOrg = await Organization.find({ "type": "lease-system" })
        } else {
            type = 'user';
            user = await User.findOne(option);
            portfolioOrg = await Organization.find({ "type": "lease-system" })
            if (!user) {
                type = 'org';
                user = await Organization.findOne(option)
            }
        }
        // portfolioOrg = config.leaseSystem.address;
        res.render('identityChain/profile.ejs', { 'user': user, 'type': type, 'portfolioOrg': portfolioOrg, 'contract_address': contract_address });
    })

    router.post('/login', passport.authenticate('user', {
        failureRedirect: '/identityChain'
    }), async function (req, res) {
        res.redirect('/identityChain/profile')
    });

    router.post('/loginOrg', passport.authenticate('org', {
        failureRedirect: '/identityChain'
    }), async function (req, res) {
        res.redirect('/identityChain/profile')
    })
    router.post('/loginWithMetamask', passport.authenticate('verifySign_DID', {
        failureRedirect: '/identityChain'
    }), async function (req, res) {
        let address = req.user;
        res.send({ 'url': '/identityChain/profile?address=' + address });
    });

    // logout Handler
    router.get('/logout', function (req, res) {
        req.session.destroy(function (err) {
            if (err) {
                console.error(err);
            } else {
                res.redirect('/identityChain/');
            }
        });
    });

    router.get('/audit', isAuthenticated, async function (req, res) {
        //let option = {"status":"false"};
        //let users = await User.findAll(option);
        res.render('identityChain/audit.ejs', { 'user': true });
    });
    router.post('/addUser', async function (req, res) {
        const { type, Name, IDNumber } = req.body;

        let user;
        let userType;
        //database find filter
        let DB_filter = {
            'IDNumber': IDNumber,
            'userName': Name
        }
        let DB_filter2 = {
            'organizationName': IDNumber,
            'personInCharge': Name
        }
        //console.log(DB_filter);
        //console.log(DB_filter2);
        if (type == "person") {//自然人
            userType = 0;
            user = await User.findOne(DB_filter);

        } else {
            userType = 1;
            user = await Organization.findOne(DB_filter2);
        }
        //console.log(user);
        // user did not in DB
        if (!user) {
            return res.send({
                msg: `user ${Name} is not exist.`
            })
        }

        // Prevent repeated addUser, resulting in random transactions
        if (user.status) {
            return res.send({
                msg: `user ${Name} already bind.`
            })
        }

        let hashed = user.hashed;

        let contractInstance = new web3.eth.Contract(identityManger.output.abi, contract_address);

        let txHash;
        let signedTxObj;
        let tx_builder = contractInstance.methods.addUser(hashed);
        let encode_tx = tx_builder.encodeABI();
        let transactionObject = {
            gas: 6721975,
            gasPrice: await web3.eth.getGasPrice(),
            data: encode_tx,
            from: config.identityChain.address,
            to: contract_address
        };

        // await web3.eth.accounts.signTransaction(transactionObject, config.identityChain.key, async function (error, signedTx) {
        //     console.log("test");
        //     if (error) {
        //         console.log("sign error");
        //     } else {
        //         signedTxObj = signedTx;
        //     }
        // })
        await web3.eth.accounts.signTransaction(transactionObject, config.identityChain.key).then(function (signedTx, error) {
            if (error) {
                console.log("sign error");
            } else {
                signedTxObj = signedTx;
            }
        })

        await web3.eth.sendSignedTransaction(signedTxObj.rawTransaction)
            .on('receipt', async function (receipt) {
                user.set({
                    status: "true",
                });
                await user.save();
                return res.send({
                    msg: `${Name}-${receipt.transactionHash}`
                });
            })
            .on('error', function (error) {
                console.log(`Send signed transaction failed.`);
                console.log(error)
                return res.status(500).send({
                    msg: "error"
                });
            })
            .catch((error) => {
                console.error(error);
                return res.send({
                    msg: error
                })
            })

    });

    router.post('/bindAccount', isAuthenticated, async function (req, res) {
        let { address, IDNumber, pubkey } = req.body;
        let type = req.user.type;
        let hashed = req.user.identity;

        let userType;
        let user;
        if (type == 'org') {
            userType = 1;
            if (pubkey == undefined) {
                return res.send({
                    msg: `User is not exist.`
                })
            }
            let option = {
                'hashed': hashed,
            }
            user = await Organization.findOne(option);
            // console.log(user)
        }
        else {
            userType = 0;

            let option = {
                'hashed': hashed,
            }
            user = await User.findOne(option);
        }
        if (!user) {
            return res.send({
                msg: `User is not exist.`
            })
        }

        let contractInstance = new web3.eth.Contract(identityManger.output.abi, contract_address);
        // console.log(config);
        let txHash;
        let signedTxObj;
        let tx_builder = contractInstance.methods.bindAccount(hashed, address, userType);
        let encode_tx = tx_builder.encodeABI();
        let transactionObject = {
            gas: 6721975,
            gasPrice: await web3.eth.getGasPrice(),
            // nonce: await web3.eth.getTransactionCount(config.admin_address.address),
            data: encode_tx,
            from: config.identityChain.address,
            to: contract_address
        }

        await web3.eth.accounts.signTransaction(transactionObject, config.identityChain.key).then(function (signedTx, error) {
            if (error) {
                console.log("sign error");
            } else {
                signedTxObj = signedTx;
            }
        })
        // await web3.eth.accounts.signTransaction(transactionObject, config.identityChain.key, async function (signedTx, error) {
        //     if (error) {
        //         console.log("sign error");
        //     } else {
        //         signedTxObj = signedTx;
        //     }
        // })

        await web3.eth.sendSignedTransaction(signedTxObj.rawTransaction)
            .on('receipt', async function (receipt) {
                user.set({
                    address: address.toLowerCase(),
                    pubkey: pubkey
                });

                await user.save();
                return res.send({
                    msg: `${IDNumber}-${receipt.transactionHash}`
                });
            })
            .catch((error) => {
                console.log(error);
                console.log(`Send signed transaction failed.`);
                return res.send({
                    msg: "This address already binded."
                })
            })
    });
    return router;
}