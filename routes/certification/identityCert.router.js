// gov use, to cert user estate and agent
const path = require('path')
const express = require('express');
const fs = require('fs');
const router = express.Router();

// session
const passport = require('passport');
const LocalStrategy = require('passport-local');

const config = JSON.parse(fs.readFileSync('./config/server_config.json', 'utf-8'));
const contract_address = config.contracts.identityManagerAddress;
const identityManger = JSON.parse(fs.readFileSync('./contracts/identityChain/IdentityManager.json', 'utf-8'));
const { Web3 } = require('web3');
const web3 = new Web3(new Web3.providers.HttpProvider(config.web3_provider));
const keccak256 = require('keccak256');
const mongoose = require('mongoose');

//fabric SDK and Util
const fabric_common = require("fabric-common");
const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const { buildCAClient, enrollAdmin, registerAndEnrollUser, getAdminIdentity, buildCertUser } = require('../../util/CAUtil');
const { buildCCPOrg1, buildWallet } = require('../../util/AppUtil');

const require_signature = "LeaseSystem?nonce:778";

var caClient;
var registerChannel, leaseChannel, estateRegisterInstance, estateAgentInstance;
var wallet;
var gateway;
var adminUser;



module.exports = function (dbconnection1) {
    const RealEstate = dbconnection1.model('realEstates', require('../../models/landAdministration/realEstate'));
    const Agency = dbconnection1.model('agencys', require('../../models/landAdministration/agency'));

    let delay = async (ms) => {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function init() {
        //console.log('google router init()');
        await delay(1000);

        // build an in memory object with the network configuration (also known as a connection profile)
        const ccp = buildCCPOrg1();

        // build an instance of the fabric ca services client based on
        // the information in the network configuration
        caClient = buildCAClient(FabricCAServices, ccp, 'ca.org1.example.com');

        const walletPath = path.join(__dirname, '../../wallet/DLA');
        wallet = await buildWallet(Wallets, walletPath);

        mspOrg1 = 'Org1MSP';
        await enrollAdmin(caClient, wallet, mspOrg1);//remember to change ca url http to https

        //get ca admin to register and enroll user
        adminUser = await getAdminIdentity(caClient, wallet)

        // in a real application this would be done only when a new user was required to be added
        // and would be part of an administrative flow
        await registerAndEnrollUser(caClient, wallet, mspOrg1, 'DLA' /*, 'org1.department1'*/);


        // Create a new gateway instance for interacting with the fabric network.
        // In a real application this would be done as the backend server session is setup for
        // a user that has been verified.
        gateway = new Gateway();

        //console.log(JSON.stringify(gateway));
        await gateway.connect(ccp, {
            wallet,
            identity: 'DLA',
            discovery: { enabled: true, asLocalhost: true }
        });

        registerChannel = await gateway.getNetwork('register-channel');
        estateRegisterInstance = await registerChannel.getContract('EstateRegister');

        leaseChannel = await gateway.getNetwork('lease-channel');
        estateAgentInstance = await leaseChannel.getContract('EstateAgent');
    }

    init();

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

    router.get('/', isAuthenticated, async (req, res) => {
        const address = req.session.address;
        const pubkey = req.session.pubkey;
        res.render('leaseSystem/certification/certification', { address: address, pubkey: pubkey });
    });

    router.post('/estateUpload', isAuthenticated, async (req, res) => {
        const { name, userAddress, userPubkey, IDNumber, houseAddress, area, date } = req.body;
        // check id pair did
        let hashed = keccak256(IDNumber).toString('hex');
        let contractInstance = new web3.eth.Contract(identityManger.output.abi, contract_address);
        let result = await contractInstance.methods.getId().call({ from: userAddress });
        if (result != hashed || !result) {
            let errors = "The ID error.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        // SKIP for test
        // check exist
        let obj = await RealEstate.findOne({ IDNumber: IDNumber, houseAddress: houseAddress });
        if (obj) {
            let errors = "The estate data already exists.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        // save to gov DB
        try {
            const realEstateData = new RealEstate({
                name: name,
                IDNumber: IDNumber,
                houseAddress: houseAddress,
                area: area,
                date: date
            })
            await realEstateData.save();
        } catch (error) {
            console.log(error);
            return res.send({ msg: "save data error." });
        }

        // save to chain
        try {
            let result = await estateRegisterInstance.submitTransaction('UploadPersonalEstate', userPubkey, houseAddress, area, date);
            console.log(result.toString());
            return res.send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.send({ msg: "error." });
        }
    });

    router.post('/agentUpload', isAuthenticated, async (req, res) => {
        const { name, userAddress, userPubkey, IDNumber, date } = req.body;

        // check id pair did
        let hashed = keccak256(IDNumber).toString('hex');
        let contractInstance = new web3.eth.Contract(identityManger.output.abi, contract_address);
        let result = await contractInstance.methods.getId().call({ from: userAddress });
        if (result != hashed || !result) {
            let errors = "The ID error.";
            console.log(errors);
            return res.send({ msg: errors });
        }

        // SKIP for test

        try {
            // check exist
            let obj = await Agency.findOne({ name: name, IDNumber: IDNumber, date: date });
            if (obj) {
                let errors = "The agent data already exists.";
                console.log(errors);
                // return res.send({ msg: errors });
            }

            // save to gov DB
            try {
                const AgencyData = new Agency({
                    name: name,
                    IDNumber: IDNumber,
                    date: date
                })
                await AgencyData.save();
            } catch (error) {
                console.log(error);
                // return res.send({ msg: "save data error." });
            }
        } catch (error) {

        }


        // save to chain
        try {
            let result = await estateAgentInstance.submitTransaction('NewAgent', userPubkey, date);
            console.log(result.toString());
            return res.send({ msg: "success." })
        } catch (error) {
            console.log(error);
            return res.send({ msg: "error." })
        }
    });

    // Evaluation /leaseSystem/certification/test
    /*
    router.post('/test/UploadPersonalEstate', async (req, res) => {
        const { userPubkey, houseAddress, area, date } = req.body;
        try {
            let result = await estateRegisterInstance.submitTransaction('TestUploadPersonalEstate', userPubkey, houseAddress, area, date);
            // console.log(result.toString());

            return res.send({ msg: "success." });
        } catch (error) {
            // console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });

    router.post('/test/GetEstate', async (req, res) => {
        const { pubkey, houseAddress } = req.body;

        try {
            let estateData = await estateRegisterInstance.evaluateTransaction('GetEstate', pubkey, houseAddress);
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });

    router.post('/test/NewAgent', async (req, res) => {
        const { userPubkey, date } = req.body;

        try {
            let result = await estateAgentInstance.submitTransaction('TestNewAgent', userPubkey, date);
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });

    router.post('/test/GetAgentCertificate', async (req, res) => {
        const { pubkey } = req.body;
        try {
            let result = await estateAgentInstance.evaluateTransaction('GetAgentCertificate', pubkey);
            return res.status(200).send({ msg: "success." });
        } catch (error) {
            console.log(error);
            return res.status(400).send({ msg: "error." });
        }
    });
    */

    return router;
}