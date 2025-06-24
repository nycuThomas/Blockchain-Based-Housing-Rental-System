const path = require('path')
const express = require('express');
const fs = require('fs');
const router = express.Router();
const openssl = require('openssl-nodejs');
const keccak256 = require('keccak256');

// session
const passport = require('passport');
const LocalStrategy = require('passport-local');

const config = JSON.parse(fs.readFileSync('./config/server_config.json', 'utf-8'));
const identityManager = JSON.parse(fs.readFileSync('./contracts/identityChain/IdentityManager.json', 'utf-8'));
const personalIdentity = JSON.parse(fs.readFileSync('./contracts/identityChain/PersonalIdentity.json', 'utf-8'));
const contract_address = config.contracts.identityManagerAddress;
const privateKey = config.leaseSystem.key;
const { Web3 } = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(config.web3_provider));

const { ethers } = require('ethers');
const { decrypt, encrypt } = require("eth-sig-util");

// HLF
const fabric_common = require("fabric-common");
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { buildCAClient, enrollAdmin, registerAndEnrollUser, getAdminIdentity, buildCertUser } = require('../../util/CAUtil');
const { buildCCPOrg2, buildWallet } = require('../../util/AppUtil');

// For testing
const elliptic = require('elliptic')
const EC = elliptic.ec;
const ecdsaCurve = elliptic.curves['p256'];
const ecdsa = new EC(ecdsaCurve);

// hash function
var cryptoSuite = fabric_common.Utils.newCryptoSuite();
var hashFunction = cryptoSuite.hash.bind(cryptoSuite);

var caClient;
var registerChannel, estateRegisterInstance;
var leaseChannel, estateAgentInstance, estatePublishInstance;
var accChannel, accInstance;
var wallet;
var gateway;
var adminUser;

var addEstate = {};
var acceptEstate = {};
var rejectEstate = {};
var newListing = {};
var updatePermission = {};

const require_signature = "LeaseSystem?nonce:778";

const mongoose = require('mongoose');

module.exports = function (dbconnection) {
    const HouseData = dbconnection.model('houseDatas', require('../../models/leaseSystem/houseData'));
    const Profile = dbconnection.model('profiles', require('../../models/leaseSystem/profile'));
    const Interest = dbconnection.model('interests', require('../../models/leaseSystem/interest'));

    let delay = async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function opensslDecode(buffer_input) {
        return new Promise(function (reslove, reject) {
            openssl(['req', '-text', '-in', { name: 'key.csr', buffer: buffer_input }, '-pubkey'], function (err, result) {
                reslove(result.toString())
            })
        })
    }

    async function init() {
        //console.log('google router init()');
        await delay(2000);

        // build an in memory object with the network configuration (also known as a connection profile)
        const ccp = buildCCPOrg2();

        // build an instance of the fabric ca services client based on
        // the information in the network configuration
        caClient = buildCAClient(FabricCAServices, ccp, 'ca.org2.example.com');

        const walletPath = path.join(__dirname, '../../wallet/system');
        wallet = await buildWallet(Wallets, walletPath);

        mspOrg2 = 'Org2MSP';
        await enrollAdmin(caClient, wallet, mspOrg2);//remember to change ca url http to https

        //get ca admin to register and enroll user
        adminUser = await getAdminIdentity(caClient, wallet)

        // in a real application this would be done only when a new user was required to be added
        // and would be part of an administrative flow
        await registerAndEnrollUser(caClient, wallet, mspOrg2, 'system' /*, 'org2.department1'*/);


        // Create a new gateway instance for interacting with the fabric network.
        // In a real application this would be done as the backend server session is setup for
        // a user that has been verified.
        gateway = new Gateway();

        //console.log(JSON.stringify(gateway));
        await gateway.connect(ccp, {
            wallet,
            identity: 'system',
            discovery: { enabled: true, asLocalhost: true }
        });

        registerChannel = await gateway.getNetwork('register-channel');
        estateRegisterInstance = await registerChannel.getContract('EstateRegister');


        leaseChannel = await gateway.getNetwork('lease-channel');
        estateAgentInstance = await leaseChannel.getContract('EstateAgent');
        estatePublishInstance = await leaseChannel.getContract('EstatePublish');

        accChannel = await gateway.getNetwork('acc-channel');
        accInstance = await accChannel.getContract('AccessControlManager');
    }
    init();

    // Login PART

    var isAuthenticated = function (req, res, next) {
        // console.log('isAuthenticated : ' + req.isAuthenticated());
        if (req.isAuthenticated()) {
            next();
        } else {
            req.flash('info', 'Login first.');
            res.redirect('/LeaseSystem/login');
        }
    };

    passport.use('verifySign_LeaseSystem', new LocalStrategy({
        usernameField: 'account',
        passwordField: 'signature',
        passReqToCallback: true
    },
        async function (req, username, password, done) {
            if (req.hashed && req.pubkey) {
                // Mapping DB data: identity => address, pubkey => pubkey
                return done(null, { 'address': username.toLowerCase(), 'pubkey': req.pubkey });
            }
        }
    ));

    router.get('/', (req, res) => {
        const identity = req.session.address;
        res.render('leaseSystem/homepage', { address: identity });
    });

    router.get('/homepage', (req, res) => {
        const identity = req.session.address;
        res.render('leaseSystem/homepage', { address: identity });
    });

    router.get('/profile', isAuthenticated, (req, res) => {
        const identity = req.session.address;
        Profile.findOne({ address: identity }).then((obj) => {
            res.render('leaseSystem/profile', { address: identity, user: obj });
        });
    });

    // router.post('/profile/profileUpdate', isAuthenticated, async (req, res) => {
    //     const identity = req.session.address;
    //     const { name } = req.body;

    //     let obj = await Profile.findOneAndUpdate(
    //         { address: identity },
    //         { name: name }, { new: true }
    //     );
    //     // console.log(obj);
    //     if (!obj) {
    //         errors = "Save data error.";
    //         console.log(errors);
    //         return res.send({ msg: errors });
    //     }

    //     res.render('leaseSystem/profile', { address: identity, user: obj });
    // });

    router.get('/login', (req, res) => {
        req.session.destroy();
        res.render('leaseSystem/login', { 'require_signature': require_signature, 'contract_address': contract_address });
    });

    router.post('/loginWithMetamask', async (req, res, next) => {
        const address = req.body.account.toLowerCase();

        let { account, signature } = req.body;
        let signingAccount = web3.eth.accounts.recover(require_signature, signature).toLowerCase();


        if (signingAccount != account.toLowerCase()) {
            return res.send({ 'msg': 'Failed to verify signature' });
        }

        let { identity, userType } = req.body;   //DID  userType=>user: 0   org: 1


        let identityManagerInstance = new web3.eth.Contract(identityManager.output.abi, contract_address);


        if (identity) {
            // Verify from the database whether the user is logging in for the first time
            var pubkey;
            try {
                let result = await Profile.findOne({ address: account.toLowerCase() });
                pubkey = result.pubkey;
                // console.log(pubkey);
            } catch {
                pubkey = null;
            }

            //check is first time login?
            if (pubkey) {       //not first time
                req.hashed = identity;
                req.pubkey = pubkey;
                next();
            } else {            //first time login
                // console.log("first time login");
                let PIContractAddress = await identityManagerInstance.methods.getAccessManagerAddress(account).call({ from: account });
                let personalIdentityInstance = new web3.eth.Contract(personalIdentity.output.abi, PIContractAddress);

                let EncryptCSRHex = await personalIdentityInstance.methods.getEncryptMaterial("HLFCSR").call({ from: account });

                //If upgrading to the latest version does not fix the issue, try downgrading to a previous version of the ethers library. You can specify a version number when installing the ethers library using the npm package manager.

                let EncryptCSR = JSON.parse(ethers.utils.toUtf8String(EncryptCSRHex));
                let CSR = decrypt(EncryptCSR, privateKey);
                let CSRDecode = await opensslDecode(Buffer.from(CSR));
                // // Decode CSR to get CN and pubkey.
                const regex = /CN=([^\s]+)\s+/;
                // let CN = CSRDecode.match(regex);
                let CN = CSRDecode.substr(CSRDecode.indexOf('CN =') + 5, account.length);
                let start_index = '-----BEGIN PUBLIC KEY-----'.length
                let end_index = CSRDecode.indexOf('-----END PUBLIC KEY-----')
                let pubkey_base64 = CSRDecode.substring(start_index, end_index).replace(/\n/g, '');
                let pubkey_hex = Buffer.from(pubkey_base64, 'base64').toString('hex');
                pubkey_hex = pubkey_hex.substr('3059301306072a8648ce3d020106082a8648ce3d030107034200'.length)

                if (CN) {
                    try {
                        // first time login this appChain
                        let attrs = [
                            { name: 'category', value: 'client', ecert: true }
                        ]
                        let secret = await caClient.register({
                            enrollmentID: CN,
                            role: 'client',
                            attrs: attrs
                        }, adminUser);

                        let enrollment = await caClient.enroll({
                            csr: CSR,
                            enrollmentID: CN,
                            enrollmentSecret: secret
                        });

                        const x509Identity = {
                            credentials: {
                                certificate: enrollment.certificate
                            },
                            mspId: mspOrg2,
                            type: 'X.509',
                        };
                        await wallet.put(address, x509Identity);
                        console.log('\x1b[33m%s\x1b[0m', "create x509 cert successfully.");
                    } catch (error) {
                        console.log(error);
                        console.log('\x1b[33m%s\x1b[0m', `${CN} already register in ca`);
                        return res.send({ 'msg': 'create x509Identity error.' });
                    }

                    try {
                        const obj = new Profile({
                            address: account.toLowerCase(),
                            agent: false,
                            pubkey: pubkey_hex
                        })
                        obj.save();
                    } catch (error) {
                        console.log(error);
                        return res.send({ 'msg': 'create profile error.' });
                    }
                    req.hashed = identity;
                    req.pubkey = pubkey_hex;
                    next();
                } else {
                    console.log("CN and account are not match.")
                    return res.send({ 'msg': 'CN and account are not match.' });
                }
            }
        } else {
            return res.send({ 'msg': 'DID dose not exist.' });
        }
    },
        passport.authenticate('verifySign_LeaseSystem'),
        async function (req, res) {
            const address = req.user.address;
            const pubkey = req.user.pubkey;
            req.session.address = address;
            req.session.pubkey = pubkey;
            res.send({ url: "/leaseSystem/profile" });
        });




    router.get('/logout', (req, res) => {
        req.session.destroy((err) => {
            if (err) {
                console.error(err);
            } else {
                res.redirect('/leaseSystem/homepage');
            }
        });
    });

    // HLF Transaction offline signing PART

    async function createTransaction() {
        // parameter 0 is user identity
        // parameter 1 is chaincode function Name
        // parameter 2 to end is chaincode function parameter
        var user = await buildCertUser(wallet, fabric_common, arguments[0]);
        var userContext = gateway.client.newIdentityContext(user);

        var endorsementStore;
        // console.log('arguments[1] = ' + arguments[1]);
        switch (arguments[1]) {
            case 'AddEstate':
                endorsementStore = addEstate;
                var endorsement = leaseChannel.channel.newEndorsement('EstateAgent');
                break;
            case 'AcceptEstate':
                endorsementStore = acceptEstate;
                var endorsement = leaseChannel.channel.newEndorsement('EstateAgent');
                break;
            case 'RejectEstate':
                endorsementStore = rejectEstate;
                var endorsement = leaseChannel.channel.newEndorsement('EstateAgent');
                break;
            case 'NewListing':
                endorsementStore = newListing;
                var endorsement = leaseChannel.channel.newEndorsement('EstatePublish');
                break;
            case 'UpdatePermission':
                endorsementStore = updatePermission;
                var endorsement = accChannel.channel.newEndorsement('AccessControlManager');
                break;
        }

        var paras = [];
        for (var i = 2; i < arguments.length; i++) {
            paras.push(arguments[i])
        }

        // Need to add other contract
        // var endorsement = leaseChannel.channel.newEndorsement('EstateAgent');
        var build_options = { fcn: arguments[1], args: paras, generateTransactionId: true };
        var proposalBytes = endorsement.build(userContext, build_options);
        const digest = hashFunction(proposalBytes);
        endorsementStore[arguments[0]] = endorsement;

        return new Promise(function (reslove, reject) {
            reslove(digest);
        })
    };

    async function proposalAndCreateCommit() {
        // parameter 0 is user identity
        // parameter 1 is chaincode function Name
        // parameter 2 is signature

        var endorsementStore;
        switch (arguments[1]) {
            case 'AddEstate':
                endorsementStore = addEstate;
                break;
            case 'AcceptEstate':
                endorsementStore = acceptEstate;
                break;
            case 'RejectEstate':
                endorsementStore = rejectEstate;
                break;
            case 'NewListing':
                endorsementStore = newListing;
                break;
            case 'UpdatePermission':
                endorsementStore = updatePermission;
                break;
        }
        if (typeof (endorsementStore) == "undefined") {
            return new Promise(function (reslove, reject) {
                reject({
                    'error': true,
                    'result': "func dosen't exist."
                });
            })
        }

        // console.log('endorsementStore = ' + JSON.stringify(endorsementStore[arguments[0]]));

        let endorsement = endorsementStore[arguments[0]];
        endorsement.sign(arguments[2]);
        // console.log(endorsement);

        let proposalResponses;
        if (arguments[1] == 'UpdatePermission') {
            proposalResponses = await endorsement.send({ targets: accChannel.channel.getEndorsers() });
        }
        else {
            proposalResponses = await endorsement.send({ targets: leaseChannel.channel.getEndorsers() });
        }

        // console.log(proposalResponses);
        // console.log('proposalResponses = ' + JSON.stringify(proposalResponses));
        // console.log('responses[0] = ' + JSON.stringify(proposalResponses.responses[0]));
        // console.log('proposalResponses.responses[0].response.status = ' + proposalResponses.responses[0].response.status);
        if (proposalResponses.error) {
            console.log(proposalResponses.error);
        }
        if (proposalResponses.responses[0].response.status == 200) {
            let user = await buildCertUser(wallet, fabric_common, arguments[0]);
            let userContext = gateway.client.newIdentityContext(user)

            let commit = endorsement.newCommit();
            let commitBytes = commit.build(userContext)
            let commitDigest = hashFunction(commitBytes)
            let result = proposalResponses.responses[0].response.payload.toString();
            endorsementStore[arguments[0]] = commit;

            return new Promise(function (reslove, reject) {
                reslove({
                    'commitDigest': commitDigest,
                    'result': result
                });
            })
        }
        else {
            return new Promise(function (reslove, reject) {
                reject({
                    'error': true,
                    'result': proposalResponses.responses[0].response.message
                });
            })
        }
    };

    async function commitSend() {
        // parameter 0 is user identity
        // parameter 1 is chaincode function Name
        // parameter 2 is signature

        var endorsementStore;
        switch (arguments[1]) {
            case 'AddEstate':
                endorsementStore = addEstate;
                break;
            case 'AcceptEstate':
                endorsementStore = acceptEstate;
                break;
            case 'RejectEstate':
                endorsementStore = rejectEstate;
                break;
            case 'NewListing':
                endorsementStore = newListing;
                break;
            case 'UpdatePermission':
                endorsementStore = updatePermission;
                break;
        }
        if (typeof (endorsementStore) == "undefined") {
            return new Promise(function (reslove, reject) {
                reject({
                    'error': true,
                    'result': "func doesn't exist."
                });
            })
        }
        let commit = endorsementStore[arguments[0]]
        commit.sign(arguments[2])
        let commitSendRequest = {};
        commitSendRequest.requestTimeout = 300000;
        if (arguments[1] == 'UpdatePermission') {
            commitSendRequest.targets = accChannel.channel.getCommitters();
        }
        else {
            commitSendRequest.targets = leaseChannel.channel.getCommitters();
        }

        let commitResponse = await commit.send(commitSendRequest);

        if (commitResponse['status'] == "SUCCESS") {
            return new Promise(function (reslove, reject) {
                reslove({
                    'result': true
                });
            })
        }
        else {
            return new Promise(function (reslove, reject) {
                reject({
                    'error': true,
                    'result': "commit error"
                });
            })
        }
    }

    function convertSignature(signature) {
        signature = signature.split("/");
        let signature_array = new Uint8Array(signature.length);
        for (var i = 0; i < signature.length; i++) {
            signature_array[i] = parseInt(signature[i])
        }
        let signature_buffer = Buffer.from(signature_array)
        return signature_buffer;
    }

    router.post("/proposalAndCreateCommit", isAuthenticated, async (req, res) => {
        try {
            let { signature, func } = req.body;

            let signature_buffer = convertSignature(signature)
            let response = await proposalAndCreateCommit(req.session.address, func, signature_buffer)
            // console.log(response);
            return res.send(response);

        } catch (error) {
            console.log(error);
            return res.send(error);
        }
    });

    router.post("/commitSend", isAuthenticated, async (req, res) => {
        try {
            let { signature, func, estateAddress, ownerAddress } = req.body;
            let signature_buffer = convertSignature(signature);
            let response = await commitSend(req.session.address, func, signature_buffer);
            console.log(response);

            // change local database
            try {
                if (!response.error && func == "NewListing") {
                    let obj = await HouseData.findOneAndUpdate({ ownerAddress: req.session.address, houseAddress: estateAddress }, { state: "online" });
                }
                else if (!response.error && func == "AcceptEstate") {
                    let obj = await HouseData.findOneAndUpdate({ ownerAddress: ownerAddress, houseAddress: estateAddress }, { agent: req.session.address, state: "agent" });
                    // console.log(obj);
                }
            } catch (error) {
                console.log("local db update error");
            }

            return res.send(response);
        } catch (error) {
            console.log(error);
            return res.send(error);
        }
    })


    // landlord PART
    router.get('/landlord', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        res.render('leaseSystem/landlord/landlord', { address: address });
    });

    router.get('/landlord/upload', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        res.render('leaseSystem/landlord/upload', { address: address });
    });

    router.get('/landlord/manageEstate', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let obj = await HouseData.find({ ownerAddress: address });
        res.render('leaseSystem/landlord/manageEstate', { address: address, HouseData: obj });
    });

    router.post('/landlord/estatePage', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { houseAddress } = req.body;
        res.send({ url: 'estatePage?addr=' + houseAddress });
    });

    router.get('/landlord/estatePage', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;
        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: houseAddress });
        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", address, houseAddress);

        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${address}/${houseAddress}/${file}`);
        }

        res.render('leaseSystem/landlord/estatePage', { address: address, HouseData: houseData, images, currentIndex: 0 });
    });

    router.post('/landlord/agent', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { houseAddress } = req.body;
        res.send({ url: 'agent?addr=' + houseAddress });
    });

    router.get('/landlord/agent', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;

        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: houseAddress });
        let agentList = await Profile.find({ agent: true });
        res.render('leaseSystem/landlord/landlordAgnet', { address: address, HouseData: houseData, agentList: agentList, contract_address: contract_address });
    });

    router.post('/landlord/rent', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { houseAddress } = req.body;
        res.send({ url: 'rent?addr=' + houseAddress });
    });


    router.get('/landlord/rent', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;
        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: houseAddress });
        res.render('leaseSystem/landlord/rent', { address: address, HouseData: houseData, contract_address: contract_address });
    });


    router.post('/landlord/estateBind', isAuthenticated, async (req, res) => {
        // get chain data, then create a record in system DB
        const address = req.session.address;
        const { houseAddress } = req.body;

        // get user public key
        let dbPubkey = await Profile.findOne({ address: address }, 'pubkey');
        let pubkey = dbPubkey.pubkey;

        // get chain data
        let estateData = await estateRegisterInstance.evaluateTransaction('GetEstate', pubkey, houseAddress);
        let data;
        try {
            data = JSON.parse(estateData);
        } catch (error) {
            let errors = "The Real Estate data does not exists on blockchain.";
            return res.send({ msg: errors });
        }

        // check exist in local
        let houseDataExist = await HouseData.findOne({ ownerAddress: address, houseAddress: data.address });
        if (houseDataExist) {
            let errors = "The estate data already exists in system.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        try {
            const houseData = new HouseData({
                ownerAddress: address,
                houseAddress: data.address,
                area: data.area,
                state: "new",
                title: '',
                describe: ''
            })
            let en_str = address.toString('hex') + data.address.toString('hex');
            let hashed = keccak256(en_str).toString('hex');
            houseData.hashed = hashed;
            await houseData.save();
        } catch (error) {
            console.log(error);
            return res.send({ msg: "save data error." });
        }

        console.log("save to system DB success");

        return res.send({ msg: "upload success." })
    });

    // initial the upload picture setting

    router.post('/landlord/estateUpdate', isAuthenticated, async (req, res) => {
        //  get local data, then update the record in system DB
        const { userAddress, houseAddress, title, roomType, describe } = req.body;
        const files = req.files ? req.files.images : null;

        if (describe != undefined && describe.length > 300) {
            return res.status(400).send("describe too long");
        }

        // 檢查是否有上傳圖片
        if (files) {
            // 檢查圖片大小是否超過 10MB
            const imageFiles = Array.isArray(files) ? files : [files];
            for (let file of imageFiles) {
                if (file.size > 10 * 1024 * 1024) { // 10MB
                    return res.status(400).send("image can not more than 10MB!");
                }
            }

            const uploadPath = path.join(__dirname, "../..", "public", "uploads", userAddress, houseAddress);
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }

            imageFiles.forEach((file) => {
                const filePath = path.join(uploadPath, file.name);
                file.mv(filePath, (err) => {
                    if (err) {
                        return res.status(500).send("can not save the images!");
                    }
                });
            });

        }


        let houseData;
        try {
            houseData = await HouseData.findOneAndUpdate(
                { ownerAddress: userAddress, houseAddress: houseAddress },
                { title: title, type: roomType, describe: describe }, { new: true }
            );
        } catch (error) {
            console.log(error);
        }

        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", userAddress, houseAddress);
        // console.log(dir);

        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${userAddress}/${houseAddress}/${file}`);
        }


        res.render('leaseSystem/landlord/estatePage', { address: userAddress, HouseData: houseData, images, currentIndex: 0 });
    });

    router.post('/landlord/entrustSubmit', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { agentPubkey, estateAddress, ownerAddress, type } = req.body;
        let owner = await Profile.findOne({ address: ownerAddress });
        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: estateAddress });
        if (!houseData) {
            console.log('houseData = ' + houseData);
            return res.send({ 'error': "error", "result": `The house address error.` });
        }

        try {
            const digest = await createTransaction(address.toLowerCase(), 'AddEstate', agentPubkey, ownerAddress, owner.pubkey, estateAddress, type);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e)
            return res.send({ 'error': "error", "result": e })
        }
    });

    router.post('/landlord/NewListing', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { estateAddress, rent, restriction } = req.body;
        let owner = await Profile.findOne({ address: address });

        // check if the house owner and is agent for someone
        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: estateAddress });
        if (!houseData) {
            console.log('houseData = ' + houseData);
            return res.send({ 'error': "error", "result": `The house not exist.` });
        }
        if (houseData.agent != '0x') {
            console.log('houseData.agent = ' + houseData.agent);
            return res.send({ 'error': "error", "result": `The house is agent to ${houseData.agent}.` });
        }
        // console.log(restriction);


        // check the house is on lease
        let isExist = await estatePublishInstance.evaluateTransaction('IsListingExist', owner.pubkey, estateAddress);
        // let isExist = await estatePublishInstance.evaluateTransaction('GetLease', owner.pubkey, estateAddress);
        // let a = JSON.parse(isExist.toString())

        if (isExist.toString() == "true") {
            console.log('exist = ' + isExist);
            return res.send({ 'error': "error", "result": "The house is published." });
        }

        // hashed (may add date)
        // let hashedString = address.toString() + estateAddress.toString();
        // let dataHash = keccak256(hashedString).toString('hex');

        try {
            const digest = await createTransaction(address.toLowerCase(), 'NewListing', owner.pubkey, houseData.ownerAddress, estateAddress, restriction, rent);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e);
            return res.send({ 'error': "error", "result": e });
        }
    });

    // Agent PART
    router.get('/agent', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let obj = await Profile.findOne({ address: address });
        res.render('leaseSystem/agent/agent', { address: address, user: obj });
    });

    router.post('/agent/getCert', isAuthenticated, async (req, res) => {
        // check agent have a cert for agent on chain, and save to localDB
        // const { userAddress } = req.body;
        const userAddress = req.session.address;

        // get user public key
        let dbPubkey = await Profile.findOne({ address: userAddress }, 'pubkey');
        let pubkey = dbPubkey.pubkey;

        // get chain data

        try {
            let obj2 = await estateAgentInstance.evaluateTransaction('GetAgentCertificate', pubkey);
            let data = JSON.parse(obj2.toString());
        } catch (error) {
            console.log(error);

            let errors = "The agent data does not exists on chain.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        // save local
        let obj = await Profile.findOneAndUpdate(
            { address: userAddress },
            { agent: true }
        );
        // console.log(obj);
        if (!obj) {
            errors = "The agent data error in system.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        return res.send({ msg: "success" });
    });

    router.get('/agent/manageAgreement', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        // get user public key
        let dbPubkey = await Profile.findOne({ address: address }, 'pubkey');
        let pubkey = dbPubkey.pubkey;

        // get chain data
        let obj2 = await estateAgentInstance.evaluateTransaction('GetAllAgentEstate', pubkey);
        let data = {};
        try {
            data = JSON.parse(obj2.toString());
        } catch (error) { }

        let agreement = [];
        Object.keys(data).forEach(function (key) {
            if (data[key].state != "reject") {
                agreement.push(data[key]);
            }
        })

        agreement.sort((a, b) => (a.estateAddress > b.estateAddress) ? 1 : ((b.estateAddress > a.estateAddress) ? -1 : 0));

        res.render('leaseSystem/agent/manageAgreement', { address: address, agreement: agreement, 'contract_address': contract_address });
    });

    router.post('/agent/AcceptEstate', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { ownerAddress, estateAddress } = req.body;
        let agent = await Profile.findOne({ address: address });

        try {
            const digest = await createTransaction(address.toLowerCase(), 'AcceptEstate', agent.pubkey, estateAddress);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e)
            return res.send({ 'error': "error", "result": e })
        }
    });

    router.post('/agent/RejectEstate', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { ownerAddress, estateAddress } = req.body;
        let owner = await Profile.findOne({ address: address });
        try {
            const digest = await createTransaction(address.toLowerCase(), 'RejectEstate', owner.pubkey, estateAddress);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e)
            return res.send({ 'error': "error", "result": e })
        }
    });

    // view and can edit estate data
    router.post('/agent/estatePage', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { estateAddress, owner } = req.body;

        // let obj = await HouseData.findOne({ ownerAddress: address, houseAddress: req.body.addr });
        res.send({ url: 'estatePage?owner=' + owner + '&addr=' + estateAddress });
    });

    router.get('/agent/estatePage', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;
        const owner = req.query.owner;

        let houseData = await HouseData.findOne({ ownerAddress: owner, houseAddress: houseAddress });
        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", owner, houseAddress);
        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${owner}/${houseAddress}/${file}`);
        }


        res.render('leaseSystem/landlord/estatePage', { address: address, HouseData: houseData, images, currentIndex: 0 });
    });


    router.post('/agent/estateUpdate', isAuthenticated, async (req, res) => {
        //  get local data, then update the record in system DB
        const address = req.session.address;
        const { ownerAddress, houseAddress, title, roomType, describe } = req.body;
        const files = req.files ? req.files.images : null;

        if (describe != undefined && describe.length > 300) {
            return res.status(400).send("describe too long");
        }

        // 檢查是否有上傳圖片
        if (files) {
            // 檢查圖片大小是否超過 10MB
            const imageFiles = Array.isArray(files) ? files : [files];
            for (let file of imageFiles) {
                if (file.size > 10 * 1024 * 1024) { // 10MB
                    return res.status(400).send("image can not more than 10MB!");
                }
            }

            const uploadPath = path.join(__dirname, "../..", "public", "uploads", ownerAddress, houseAddress);
            if (!fs.existsSync(uploadPath)) {
                fs.mkdirSync(uploadPath, { recursive: true });
            }

            imageFiles.forEach((file) => {
                const filePath = path.join(uploadPath, file.name);
                file.mv(filePath, (err) => {
                    if (err) {
                        return res.status(500).send("can not save the images!");
                    }
                });
            });

        }

        let houseData;
        try {
            houseData = await HouseData.findOneAndUpdate(
                { ownerAddress: ownerAddress, houseAddress: houseAddress },
                { title: title, type: roomType, describe: describe }, { new: true }
            )
        } catch (error) {
            console.log(error);
        }

        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", ownerAddress, houseAddress);
        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${owner}/${houseAddress}/${file}`);
        }


        res.render('leaseSystem/landlord/estatePage', { address: address, HouseData: houseData, images, currentIndex: 0 });
    });

    // setting estate rent data and rent
    router.post('/agent/rent', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { houseAddress, owner } = req.body;

        // let obj = await HouseData.findOne({ ownerAddress: address, houseAddress: req.body.addr });
        res.send({ url: 'rent?owner=' + owner + '&addr=' + houseAddress });
    });

    router.get('/agent/rent', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const addr = req.query.addr;
        const owner = req.query.owner;
        let houseData = await HouseData.findOne({ ownerAddress: owner, houseAddress: addr });
        res.render('leaseSystem/agent/agentRent', { address: address, HouseData: houseData, contract_address: contract_address });
    });

    router.post('/agent/NewListing', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let { ownerAddress, estateAddress, rent, restriction } = req.body;
        let owner = await Profile.findOne({ address: ownerAddress });
        let agent = await Profile.findOne({ address: address });

        // check is agent to user
        let houseData = await HouseData.findOne({ ownerAddress: ownerAddress, houseAddress: estateAddress });
        if (houseData.agent != address) {
            console.log('houseData.agent = ' + houseData.agent);
            return res.send({ 'error': "error", "result": `The house is agent to ${houseData.agent} not ${address}.` });
        }

        // check the house is on lease
        let isExist = await estatePublishInstance.evaluateTransaction('IsListingExist', owner.pubkey, estateAddress);
        let isExistAgent = await estatePublishInstance.evaluateTransaction('IsListingExist', agent.pubkey, estateAddress);
        if (isExist.toString() == "true" && isExistAgent.toString() == "true") {
            console.log('exist = ' + isExist + " , " + isExistAgent);
            return res.send({ 'error': "error", "result": "The house is already published." });
        }

        // hashed (may add date)
        // let hashedString = address.toString() + estateAddress.toString();
        // let dataHash = keccak256(hashedString).toString('hex');

        try {
            const digest = await createTransaction(address.toLowerCase(), 'NewListing', agent.pubkey, houseData.ownerAddress, estateAddress, restriction, rent);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e);
            return res.send({ 'error': "error", "result": e });
        }
    });

    router.post('/agent/profileUpdate', isAuthenticated, async (req, res) => {
        //  get local data, then update the record in system DB
        const { userAddress, name, Agency } = req.body;

        let userData = await Profile.findOneAndUpdate(
            { address: userAddress, agent: true },
            { name: name, agency: Agency }, { new: true }
        );
        // console.log(userData);
        if (!userData) {
            let errors = "The agent data error in system.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        res.render('leaseSystem/agent/agent', { address: userAddress, user: userData });
    });

    // Search lease PART
    var allLease = [];
    // show all rent data in blockchain
    router.get('/searchHouse', async (req, res) => {
        const address = req.session.address;
        let obj2 = await estatePublishInstance.evaluateTransaction('GetAllOnlineListing');
        let data = {};
        try {
            data = JSON.parse(obj2.toString());
        } catch (error) {
            console.log(error);
            data = obj2;
        }
        // console.log(data);


        // let houseList = [];
        // for (let index = 0; index < data.length; index++) {
        //     houseList.push(data[index]);
        //     // Object.values(data[index]).forEach(value => {

        //     //     if (value.state == "online") {
        //     //         houseList.push(value);
        //     //     }
        //     // });
        // }
        allLease = data;
        res.render('leaseSystem/searchHouse', { address: address, houseList: data });
    });

    // view the house detail data
    router.post('/searchHouse/leasePage', async (req, res) => {
        // const address = req.session.address;
        const { addr, uploader } = req.body;
        res.send({ url: 'leasePage?addr=' + addr + '&uploader=' + uploader });
    });


    router.get('/leasePage', async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;
        const uploader = req.query.uploader;

        let uploaderData = await Profile.findOne({ pubkey: uploader });

        let houseData = await HouseData.findOne({ ownerAddress: uploaderData.address, houseAddress: houseAddress });
        if (!houseData) {
            houseData = await HouseData.findOne({ agent: uploaderData.address, houseAddress: houseAddress });
        }

        let leaseData = await estatePublishInstance.evaluateTransaction('GetListing', uploader, houseAddress);
        let data = {};
        try {
            data = JSON.parse(leaseData.toString());
        } catch (error) {
            console.log(error);
            data = leaseData;
        }

        let added = false;
        try {
            if (address != undefined) {
                let isAdd = await Interest.findOne({ address: address, ownerAddress: uploaderData.address, houseAddress: houseAddress });
                // console.log(isAdd);

                if (isAdd) {
                    added = true;
                }
            }
        } catch (error) { }

        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", houseData.ownerAddress, houseAddress);
        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${houseData.ownerAddress}/${houseAddress}/${file}`);
        }


        res.render('leaseSystem/leasePage', { address: address, HouseData: houseData, rentData: data, added: added, images, currentIndex: 0 });
    });

    // tenant add this house to favorite
    router.post('/searchHouse/leasePage/addFavorite', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { houseAddress, ownerAddress, agentAddress } = req.body;
        try {
            let obj = new Interest({
                address: address,
                ownerAddress: ownerAddress,
                houseAddress: houseAddress,
                agentAddress: agentAddress,
                willingness: false,
                agreement: false
            })
            await obj.save();
            return res.send({ msg: "add favorite success" });
        } catch (error) {
            return res.send({ msg: "add favorite error" });
        }
    });

    router.post('/searchHouse/leasePage/remove', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { houseAddress, ownerAddress } = req.body;
        try {
            let obj = await Interest.findOneAndDelete({
                address: address,
                ownerAddress: ownerAddress,
                houseAddress: houseAddress
            })

            return res.send({ msg: "remove favorite success" });
        } catch (error) {
            return res.send({ msg: "remove favorite error" });
        }
    });

    // tenant ready to sign this house
    router.post('/searchHouse/leasePage/newSigner', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { houseAddress, ownerAddress } = req.body;
        try {
            let obj = await Interest.findOneAndUpdate({
                address: address,
                ownerAddress: ownerAddress,
                houseAddress: houseAddress
            }, { willingness: true })

            return res.send({ msg: "update success, please waiting for owner accept and create the agreement" });
        } catch (error) {
            return res.send({ msg: "update error" });
        }
    });


    // Access control offline sign PART

    router.post('/updatePermission', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { job, salary, deposit, endTime } = req.body;
        let user = await Profile.findOne({ address: address });
        let attributes = {
            "job": job,
            "salary": salary,
            "deposit": deposit
        }
        try {
            const digest = await createTransaction(address.toLowerCase(), 'UpdatePermission', user.pubkey, JSON.stringify(attributes), endTime);
            return res.send({ 'digest': digest });
        } catch (e) {
            console.log('e = ' + e);
            return res.send({ 'error': "error", "result": e });
        }
    });

    // Agreement PART

    // View favorite and rent house situation , can choose person to create a agreement
    router.get('/leaseManage', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        let favoriteList = await Interest.find({ address: address });
        let signerList;

        let ownerSignerList = await Interest.find({ ownerAddress: address, willingness: true });
        let agentSignerList = await Interest.find({ agentAddress: address, willingness: true });

        signerList = ownerSignerList.concat(agentSignerList);

        let user = await Profile.findOne({ address: address });
        let rentData = [];
        let data = {};
        try {
            let leaseData = await estatePublishInstance.evaluateTransaction('GetPersonListing', user.pubkey);
            data = JSON.parse(leaseData.toString());
        } catch (error) {
            data = {};
        }
        Object.keys(data).forEach(function (key) {
            rentData.push(data[key]);
        })

        if (!allLease.length) {
            let obj2 = await estatePublishInstance.evaluateTransaction('GetAllOnlineListing');
            let data = JSON.parse(obj2.toString());
            // console.log(data);
            allLease = data;
            // for (let index = 0; index < data.length; index++) {
            //     Object.values(data[index].Data).forEach(value => {
            //         if (value.state == "online") {
            //             allLease.push(value);
            //         }
            //     });
            // }
        }

        allLease.forEach(elelment => {
            if (elelment.owner == user.address && elelment.uploader != user.pubkey) {
                rentData.push(elelment);
            }
        });

        res.render('leaseSystem/leaseManage', { address: address, favorite: favoriteList, signerList: signerList, rentData: rentData });
    });

    router.post('/leaseManage/leasePage', async (req, res) => {
        // const address = req.session.address;
        const { addr, owner, agent } = req.body;
        res.send({ url: 'leaseManage/leasePage?addr=' + addr + '&owner=' + owner + '&agent=' + agent });
    });


    router.get('/leaseManage/leasePage', async (req, res) => {
        const address = req.session.address;
        const houseAddress = req.query.addr;
        const owner = req.query.owner;
        const agent = req.query.agent;
        let ownerData = await Profile.findOne({ address: owner });

        let houseData = await HouseData.findOne({ ownerAddress: ownerData.address, houseAddress: houseAddress });

        let leaseData;
        if (agent == "0x") {
            leaseData = await estatePublishInstance.evaluateTransaction('GetListing', ownerData.pubkey, houseAddress);
        }
        else {
            let agentData = await Profile.findOne({ address: agent });
            leaseData = await estatePublishInstance.evaluateTransaction('GetListing', agentData.pubkey, houseAddress);
        }
        let data = {};
        try {
            data = JSON.parse(leaseData.toString());
        } catch (error) {
            // console.log(error);
            data = leaseData;
        }


        let added = false;
        try {
            if (address != undefined) {
                let isAdd = await Interest.findOne({ address: address, ownerAddress: ownerData.address, houseAddress: houseAddress });
                if (isAdd) {
                    added = true;
                }
            }
        } catch (error) { }

        //  images
        const dir = path.join(__dirname, "../..", "public", "uploads", houseData.ownerAddress, houseAddress);
        let images = [];
        if (fs.existsSync(dir)) {
            images = fs.readdirSync(dir).filter((file) => file.endsWith(".jpg") || file.endsWith(".jpeg") || file.endsWith(".png")).map((file) => `/uploads/${houseData.ownerAddress}/${houseAddress}/${file}`);
        }

        res.render('leaseSystem/leasePage', { address: address, HouseData: houseData, rentData: data, added: added, images, currentIndex: 0 });
    });



    // owner create agreement, can edit agreement content 
    router.post('/leaseManage/agreement', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const { signer, estateAddress, uploaderKey } = req.body;
        // check the user has a access right to this house
        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: estateAddress });
        if (!houseData) {
            houseData = await HouseData.findOne({ agent: address, houseAddress: estateAddress });
        }
        let userData = await Profile.findOne({ address: address }, 'address pubkey');

        if (houseData.agent == address) {
            userData = await Profile.findOne({ address: address }, 'address pubkey');

            let agentOnChain;
            let agentEstate;
            try {
                agentOnChain = await estateAgentInstance.evaluateTransaction('GetAgentEstate', userData.pubkey, estateAddress);
                agentEstate = JSON.parse(agentOnChain.toString());
                if (agentEstate.type != "Escrow") {
                    res.send({ msg: 'agreement need to create by the owner.' });
                    return;
                }
            } catch (error) {
                console.log(error);
                res.send({ msg: 'error' });
                return;
            }
        }
        // let obj = await HouseData.findOne({ ownerAddress: address, houseAddress: req.body.addr });
        res.send({ url: `leaseManage/createAgreement?f=${signer}&e=${estateAddress}&k=${uploaderKey} ` });
    });

    router.get('/leaseManage/createAgreement', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const signer = req.query.f;
        const estateAddress = req.query.e;
        const uploaderKey = req.query.k;

        let houseData = await HouseData.findOne({ ownerAddress: address, houseAddress: estateAddress });
        if (!houseData) {
            houseData = await HouseData.findOne({ agent: address, houseAddress: estateAddress });
        }
        let ownerData = await Profile.findOne({ address: houseData.ownerAddress }, 'address pubkey');
        let userData = ownerData;
        if (houseData.agent == address) {
            userData = await Profile.findOne({ address: address }, 'address pubkey');

            let agentOnChain;
            let agentEstate;
            try {
                agentOnChain = await estateAgentInstance.evaluateTransaction('GetAgentEstate', uploaderKey, estateAddress);
                agentEstate = JSON.parse(agentOnChain.toString());
                if (agentEstate.type != "Escrow") {
                    res.send({ msg: 'agreement need to create by the owner.' });
                }
            } catch (error) {
                console.log(error);
                res.send({ msg: 'error' });
            }
        }

        let tenant = await Profile.findOne({ address: signer }, 'address pubkey');
        let rentData = {};
        try {
            let obj3 = await estatePublishInstance.evaluateTransaction('GetListing', uploaderKey, estateAddress);
            rentData = JSON.parse(obj3.toString());
        } catch (error) {
            console.log(error);
            rentData = {};
        }
        res.render('leaseSystem/agreement/createAgreement', {
            address: address,
            houseData: houseData, rentData: rentData,
            userData: userData, tenantData: tenant,
            contract_address: contract_address
        });
    });

    // already add a agreement in blockchain , edit DB
    router.post('/leaseManage/agreementCreateDone', isAuthenticated, async (req, res) => {
        // const address = req.session.address;
        const { hashed, ownerAddress, houseAddress, tenantAddress } = req.body;
        let obj = await HouseData.findOneAndUpdate({ ownerAddress: ownerAddress, houseAddress: houseAddress }, { rentHashed: hashed, state: "signing" });
        let obj2 = await Interest.findOneAndUpdate({
            address: tenantAddress,
            ownerAddress: ownerAddress,
            houseAddress: houseAddress
        }, { agreement: true });
        if (obj && obj2) {
            res.send({ msg: `success` });
        }
        else {
            res.send({ msg: `error` });
        }
    });

    router.post('/leaseManage/upload', isAuthenticated, async (req, res) => {
        const { ownerAddress, houseAddress } = req.body;
        let owner = await Profile.findOne({ address: ownerAddress });
        let ownerPubkey = owner.pubkey;
        res.send({ url: 'dataSharing/upload?owner=' + ownerAddress + '&house=' + houseAddress + '&key=' + ownerPubkey });
    });

    // Evaluation leaseSystem/
    /* for Testing
        // offline sign
        const preventMalleability = (sig, ecdsa) => {
            const halfOrder = ecdsa.n.shrn(1);
            if (sig.s.cmp(halfOrder) === 1) {
                const bigNum = ecdsa.n;
                sig.s = bigNum.sub(sig.s);
            }
            return sig;
        };
    
        function sign(privateKey, digest) {
            const signKey = ecdsa.keyFromPrivate(privateKey, 'hex');
            const sig = ecdsa.sign(Buffer.from(digest, 'hex'), signKey);
            var halfOrderSig = preventMalleability(sig, ecdsa);
            const signature = Buffer.from(halfOrderSig.toDER());
            var signature_string = '';
            for (var i = 0; i < signature.length; i++) {
                signature_string += signature[i].toString();
                signature_string += '/';
            }
            signature_string = signature_string.slice(0, -1);
            return signature_string;
        }
    
        // UpdatePermission NewListing RejectEstate AcceptEstate AddEstate
        router.post('/test/offlineSign', async (req, res) => {
            var startTime = process.hrtime();
    
            const digest = await createTransaction("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'funName', 'aaa', 'aaa', 'aaa', 0, -1);
    
    
            let privateKey = "2735d63dcd56aa8b8c880f73448fcf1df6865544822ee7990fbffe96e205c36d";
    
            let signature_string = sign(privateKey, digest);
    
            let signature_buffer = convertSignature(signature_string)
            let response = await proposalAndCreateCommit("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'funName', signature_buffer);
            signature_string = sign(privateKey, response.commitDigest);
    
    
            signature_buffer = convertSignature(signature_string);
            response = await commitSend("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'funName', signature_buffer);
    
            var endTime = process.hrtime(startTime);
            console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
            return res.send({ msg: `success` });
        })
    
        router.post('/test/AddEstate', async (req, res) => {
    
            let { agentPubkey, ownerAddress, pubkey, estateAddress, type } = req.body;
    
            // var startTime = process.hrtime();
            const digest = await createTransaction("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'AddEstate', agentPubkey, ownerAddress, pubkey, estateAddress, type);
    
            let privateKey = "2735d63dcd56aa8b8c880f73448fcf1df6865544822ee7990fbffe96e205c36d";
    
            let signature_string = sign(privateKey, digest);
    
            let signature_buffer = convertSignature(signature_string)
            let response = await proposalAndCreateCommit("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'AddEstate', signature_buffer);
            signature_string = sign(privateKey, response.commitDigest);
    
    
            signature_buffer = convertSignature(signature_string);
            response = await commitSend("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'AddEstate', signature_buffer);
    
            // var endTime = process.hrtime(startTime);
            // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
            return res.send({ msg: `success` });
        })
    
        router.post('/test/RejectEstate', async (req, res) => {
            try {
                let { agentPubkey, estateAddress } = req.body;
    
                // var startTime = process.hrtime();
                const digest = await createTransaction("0x889735777f51c84272a7feb0d763280179a529a9", 'RejectEstate', agentPubkey, estateAddress);
    
                let privateKey = "b77736e613ee0e072132fa899247fcec2315b92b7a92fff7615fb1e3f2218fef";
    
                let signature_string = sign(privateKey, digest);
    
                let signature_buffer = convertSignature(signature_string)
                let response = await proposalAndCreateCommit("0x889735777f51c84272a7feb0d763280179a529a9", 'RejectEstate', signature_buffer);
                signature_string = sign(privateKey, response.commitDigest);
    
    
                signature_buffer = convertSignature(signature_string);
                response = await commitSend("0x889735777f51c84272a7feb0d763280179a529a9", 'RejectEstate', signature_buffer);
    
                // var endTime = process.hrtime(startTime);
                // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
                return res.send({ msg: `success` });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: `error` });
            }
    
        })
    
        router.post('/test/AcceptEstate', async (req, res) => {
            try {
                let { agentPubkey, estateAddress } = req.body;
    
                // var startTime = process.hrtime();
                const digest = await createTransaction("0x889735777f51c84272a7feb0d763280179a529a9", 'AcceptEstate', agentPubkey, estateAddress);
    
                let privateKey = "b77736e613ee0e072132fa899247fcec2315b92b7a92fff7615fb1e3f2218fef";
    
                let signature_string = sign(privateKey, digest);
    
                let signature_buffer = convertSignature(signature_string)
                let response = await proposalAndCreateCommit("0x889735777f51c84272a7feb0d763280179a529a9", 'AcceptEstate', signature_buffer);
                signature_string = sign(privateKey, response.commitDigest);
    
    
                signature_buffer = convertSignature(signature_string);
                response = await commitSend("0x889735777f51c84272a7feb0d763280179a529a9", 'AcceptEstate', signature_buffer);
    
                // var endTime = process.hrtime(startTime);
                // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
                return res.send({ msg: `success` });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: `error` });
            }
    
        })
    
        router.post('/test/GetAgentEstate', async (req, res) => {
            const { pubkey, estateAddress } = req.body;
            try {
                let agentOnChain = await estateAgentInstance.evaluateTransaction('GetAgentEstate', pubkey, estateAddress);
                return res.status(200).send({ msg: "success." });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: "error." });
            }
        });
    
    
        router.post('/test/NewListing', async (req, res) => {
    
            let { pubkey, ownerAddress, estateAddress, restriction, rent } = req.body;
    
    
            // var startTime = process.hrtime();
            try {
                const digest = await createTransaction("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'NewListing', pubkey, ownerAddress, estateAddress, restriction, rent);
    
                let privateKey = "2735d63dcd56aa8b8c880f73448fcf1df6865544822ee7990fbffe96e205c36d";
    
                let signature_string = sign(privateKey, digest);
    
                let signature_buffer = convertSignature(signature_string)
                let response = await proposalAndCreateCommit("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'NewListing', signature_buffer);
                signature_string = sign(privateKey, response.commitDigest);
    
    
                signature_buffer = convertSignature(signature_string);
                response = await commitSend("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'NewListing', signature_buffer);
                return res.send({ msg: `success` });
            } catch (error) {
                console.log(error);
                return res.send({ msg: `error` });
            }
    
    
            // var endTime = process.hrtime(startTime);
            // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
    
        })
    
        router.post('/test/system/NewListing', async (req, res) => {
    
            let { pubkey, ownerAddress, estateAddress, restriction, rent } = req.body;
    
    
            try {
                let result = await estatePublishInstance.submitTransaction('TestNewListing', pubkey, ownerAddress, estateAddress, restriction, rent);
                // console.log(result.toString());
    
                return res.send({ msg: "success." });
            } catch (error) {
                // console.log(error);
                return res.status(400).send({ msg: "error." });
            }
    
            // var endTime = process.hrtime(startTime);
            // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
    
        })
    
        router.post('/test/GetAllOnlineListing', async (req, res) => {
            var startTime = process.hrtime();
            let obj2 = await estatePublishInstance.evaluateTransaction('GetAllOnlineListing');
            let data = JSON.parse(obj2.toString());
    
            var endTime = process.hrtime(startTime);
            console.log(`${data.length} Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
            return res.send({ msg: `success` });
        })
    
        router.post('/test/GetOnlineListing', async (req, res) => {
            let { bookmark } = req.body;
            var startTime = process.hrtime();
            let obj2 = await estatePublishInstance.evaluateTransaction('TestGetOnlineListing');
            let data = JSON.parse(obj2.toString());
            console.log(data.length);
    
            var endTime = process.hrtime(startTime);
            console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
            return res.send({ msg: `success` });
        })
    
        router.post('/test/GetListing', async (req, res) => {
            const { pubkey, houseAddress } = req.body;
            try {
                let leaseData = await estatePublishInstance.evaluateTransaction('GetListing', pubkey, houseAddress);
                return res.status(200).send({ msg: "success." });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: "error." });
            }
        });
    
    
        router.post('/test/UpdatePermission', async (req, res) => {
            try {
                let { pubkey, attributes, endTime } = req.body;
    
                // var startTime = process.hrtime();
                const digest = await createTransaction("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'UpdatePermission', pubkey, JSON.stringify(attributes), endTime);
    
                let privateKey = "2735d63dcd56aa8b8c880f73448fcf1df6865544822ee7990fbffe96e205c36d";
    
                let signature_string = sign(privateKey, digest);
    
                let signature_buffer = convertSignature(signature_string)
                let response = await proposalAndCreateCommit("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'UpdatePermission', signature_buffer);
                signature_string = sign(privateKey, response.commitDigest);
    
    
                signature_buffer = convertSignature(signature_string);
                response = await commitSend("0x6f03947036cba3279b07cd6ea5ca674ca51e52ba", 'UpdatePermission', signature_buffer);
    
                // var endTime = process.hrtime(startTime);
                // console.log(`Time taken: ${endTime[0]}s ${endTime[1] / 1000000}ms`);
                return res.send({ msg: `success` });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: `error` });
            }
    
        })
    
        router.post('/test/GetPermission', async (req, res) => {
            const { tenantPubkey, landlordPubkey } = req.body;
            try {
                let permitBuffer = await accInstance.evaluateTransaction('GetPermission', tenantPubkey, landlordPubkey);
                return res.status(200).send({ msg: "success." });
            } catch (error) {
                console.log(error);
                return res.status(400).send({ msg: "error." });
            }
        });
    
    
    
        router.post('/test/login', async (req, res, next) => {
            let { identity, pubkey } = req.body;   //DID  userType=>user: 0   org: 1
            // console.log(req.body);
            req.session.address = identity;
            req.session.pubkey = pubkey;
            if (identity) {
    
                req.hashed = identity;
                req.pubkey = pubkey;
                next();
    
            } else {
                return res.status(400).send({ 'msg': `${identity} not exist` });
            }
        },
            async function (req, res) {
                res.send({ url: "/leaseSystem/profile" });
            }); 
    */

    return router;
}