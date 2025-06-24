'use strict';

const { Contract } = require('fabric-contract-api');
const tls = require('tls');
const net = require('net');

function uint8arrayToStringMethod(myUint8Arr) {
  return String.fromCharCode.apply(null, myUint8Arr);
}

class EstatePublish extends Contract {
  // async GetIdentity(ctx) {
  //   let org = ctx.clientIdentity.getMSPID();
  //   let ID = ctx.clientIdentity.getID();
  //   let IDBytes = ctx.clientIdentity.getIDBytes();

  //   let secureContext = tls.createSecureContext({
  //     cert: uint8arrayToStringMethod(IDBytes)
  //   });
  //   let secureSocket = new tls.TLSSocket(new net.Socket(), { secureContext });
  //   let cert = secureSocket.getCertificate();
  //   //console.log(cert)
  //   let pubkey = cert.pubkey.toString('hex');

  //   return pubkey;
  // }

  async NewListing(ctx, userPubkey, owner, estateAddress, restrictions, rent) {
    let lease = await ctx.stub.getState(userPubkey);
    let leaseJson;
    try {
      if (!lease || lease.length === 0) {
        throw `The user key:${userPubkey} does not exist`;
      }
      leaseJson = JSON.parse(lease.toString());
    }
    catch (error) {
      console.log(error);
      leaseJson =
      {
        Data: {}
      };
    }

    if (!leaseJson.Data[estateAddress]) {
      leaseJson.Data[estateAddress] = {};
    }

    let attJson;
    try {
      attJson = JSON.parse(restrictions.toString());
    } catch (error) {
      console.log(restrictions.toString());
      attJson = restrictions;
    }

    leaseJson.Data[estateAddress] = {
      "uploader": userPubkey,
      "estateAddress": estateAddress,
      "owner": owner,
      "rent": rent,
      "state": "online",
      "restriction": {}
    }

    Object.keys(attJson).forEach(async key => {
      // console.log(`${key} : ${attJson[key]}`);
      leaseJson.Data[estateAddress].restriction[key] = attJson[key];
    })

    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
    return "Add Lease successfully." + userPubkey;
  }

  // async NewLeaseBackup(ctx, userPubkey, owner, estateAddress, rent) {
  //   let lease = await ctx.stub.getState(userPubkey);
  //   let leaseJson;
  //   try {
  //     if (!lease || lease.length === 0) {
  //       throw `The user key:${userPubkey} does not exist`;
  //     }
  //     leaseJson = JSON.parse(lease.toString());
  //   }
  //   catch (error) {
  //     console.log(error);
  //     leaseJson =
  //     {
  //       Data: {}
  //     };
  //   }

  //   if (!leaseJson.Data[estateAddress]) {
  //     leaseJson.Data[estateAddress] = {};
  //   }

  //   leaseJson.Data[estateAddress] = {
  //     "uploader": userPubkey,
  //     "estateAddress": estateAddress,
  //     "owner": owner,
  //     "rent": rent,
  //     "state": "online"
  //   }

  //   await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
  //   return "Add Lease successfully." + userPubkey;
  // }

  async DelListing(ctx, userPubkey, estateAddress) {
    let lease = await ctx.stub.getState(userPubkey);
    let leaseJson = JSON.parse(lease.toString());
    if (!lease || lease.length === 0) {
      return "Lease not exist." + estateAddress;
    }

    if (leaseJson.Data && leaseJson.Data[estateAddress]) {
      delete leaseJson.Data[estateAddress];
    }
    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
    return "Update Estate successfully." + userPubkey;
  }

  async GetPersonListing(ctx, userPubkey) {
    let lease = await ctx.stub.getState(userPubkey);
    if (!lease || lease.length === 0) {
      throw new Error(`The user key:${userPubkey} does not exist`);
    }
    let leaseJson = JSON.parse(lease.toString());
    const leaseData = leaseJson.Data;

    return JSON.stringify(leaseData);
  }

  async GetListing(ctx, userPubkey, estateAddress) {
    let lease = await ctx.stub.getState(userPubkey);
    if (!lease || lease.length === 0) {
      throw new Error(`The user key:${userPubkey} does not exist`);
    }
    let leaseJson = JSON.parse(lease.toString());
    const leaseData = leaseJson.Data[estateAddress];

    return JSON.stringify(leaseData);
  }

  async GetListingCondiction(ctx, userPubkey, estateAddress) {
    let lease = await ctx.stub.getState(userPubkey);
    if (!lease || lease.length === 0) {
      throw new Error(`The user key:${userPubkey} does not exist`);
    }
    let leaseJson = JSON.parse(lease.toString());
    const restrictionData = leaseJson.Data[estateAddress].restriction;

    return JSON.stringify(restrictionData);
  }

  async ListingSigned(ctx, userPubkey, estateAddress) {
    let lease = await ctx.stub.getState(userPubkey);
    if (!lease || lease.length === 0) {
      throw new Error(`The user key:${userPubkey} does not exist`);
    }
    let leaseJson = JSON.parse(lease.toString());
    leaseJson.Data[estateAddress].state = "signed";

    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
    return "Update Lease Signed successfully.";
  }

  async IsListingExist(ctx, userPubkey, estateAddress) {
    let lease = await ctx.stub.getState(userPubkey);
    if (lease && lease.length > 0) {
      let leaseJson = JSON.parse(lease.toString());
      return leaseJson.Data.hasOwnProperty(estateAddress);
    }
    else {
      return false;
    }
  }

  async GetAllOnlineListing(ctx) {
    const allResults = [];
    // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
    const iterator = await ctx.stub.getStateByRange('', '');
    let result = await iterator.next();
    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString('utf8');

      let record;
      try {
        record = JSON.parse(strValue);
      } catch (err) {
        console.log(err);
        record = strValue;
      }
      console.log(record);
      Object.values(record.Data).forEach(value => {
        if (value.state == "online") {
          console.log(value);
          allResults.push(value);
        }
      });

      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }
/*  For Testing
  async TestGetOnlineListing(ctx) {
    const allResults = [];
    // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
    const PaginationQueryResponse = await ctx.stub.getStateByRangeWithPagination('', '', 100, "");
    // console.log(PaginationQueryResponse);
    
    let iterator = PaginationQueryResponse.iterator;
    let result = await iterator.next();
    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString('utf8');

      let record;
      try {
        record = JSON.parse(strValue);
      } catch (err) {
        console.log(err);
        record = strValue;
      }
      console.log(record);
      Object.values(record.Data).forEach(value => {
        if (value.state == "online") {
          console.log(value);
          allResults.push(value);
        }
      });

      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }

  async GetOnlineListing(ctx, bookmark) {
    const allResults = [];
    // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
    const {iterator, metadata} = await ctx.stub.getStateByRangeWithPagination('', '', 100, bookmark);
    // console.log(iterator);
    // console.log(metadata);
    
    
    let result = await iterator.next();
    while (!result.done) {
      const strValue = Buffer.from(result.value.value.toString()).toString('utf8');

      let record;
      try {
        record = JSON.parse(strValue);
      } catch (err) {
        console.log(err);
        record = strValue;
      }
      console.log(record);
      Object.values(record.Data).forEach(value => {
        if (value.state == "online") {
          console.log(value);
          allResults.push(value);
        }
      });

      result = await iterator.next();
    }
    return JSON.stringify(allResults);
  }

  async TestListingSigned(ctx, userPubkey, estateAddress) {

    try {
      let lease = await ctx.stub.getState(userPubkey);
      let leaseJson;
      if (!lease || lease.length === 0) {
        leaseJson.Data[estateAddress] = {
          "uploader": userPubkey,
          "estateAddress": estateAddress,
          "owner": "owner",
          "rent": "rent",
          "state": "online",
          "restriction": {}
        }
        // throw new Error(`The user key:${userPubkey} does not exist`);
      }
      else {
        leaseJson = JSON.parse(lease.toString());
      }

      leaseJson.Data[estateAddress].state = "signed";

      await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
    } catch (error) {
      letleaseJson =
      {
        Data: {}
      };
      leaseJson.Data[estateAddress] = {
        "uploader": userPubkey,
        "estateAddress": estateAddress,
        "owner": "owner",
        "rent": "rent",
        "state": "signed",
        "restriction": {}
      }
      await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
      return "Update Lease Signed fail."
    }

    return "Update Lease Signed successfully.";
  }

  async TestNewListing(ctx, userPubkey, owner, estateAddress, restrictions, rent) {

    let leaseJson =
    {
      Data: {}
    };

    let attJson;
    try {
      attJson = JSON.parse(restrictions.toString());
    } catch (error) {
      console.log(restrictions.toString());
      attJson = restrictions;
    }

    leaseJson.Data[estateAddress] = {
      "uploader": userPubkey,
      "estateAddress": estateAddress,
      "owner": owner,
      "rent": rent,
      "state": "online",
      "restriction": {}
    }

    Object.keys(attJson).forEach(async key => {
      // console.log(`${key} : ${attJson[key]}`);
      leaseJson.Data[estateAddress].restriction[key] = attJson[key];
    })

    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(leaseJson)));
    return "Add Lease successfully." + userPubkey;
  }
  */
}

exports.contracts = [EstatePublish];
