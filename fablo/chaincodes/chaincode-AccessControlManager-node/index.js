'use strict';

const { Contract } = require('fabric-contract-api');
const tls = require('tls');
const net = require('net');
//const ethSigUtil = require("eth-sig-util");

function uint8arrayToStringMethod(myUint8Arr) {
  return String.fromCharCode.apply(null, myUint8Arr);
}

class AccessControlManager extends Contract {
  async AddPersonalAccessControl(ctx, userPubkey) {
    //only admin can add a new User key
    let type = ctx.clientIdentity.getAttributeValue("hf.Type");
    let acc = await ctx.stub.getState(userPubkey);

    if (type != "admin") {
      throw new Error(`only admin can execute.`);
    }
    if (acc && acc.length > 0) {
      throw new Error(`User already exists`);
    } else {
      let accessControl =
      {
        Permission: {} // only user can change
      };
      await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(accessControl)));
      return "Create Successfully."
    }
  }
  
  async GetUserAccControl(ctx, key) {
    //Only the organization that public in acc can read
    let pubkey = await this.GetIdentity(ctx);
    const acc = await ctx.stub.getState(key);

    if (!acc || acc.length === 0) {
      throw new Error(`The user acc key:${key} does not exist`);
    }

    return acc.toString();
  }

  async UserAccControlExist(ctx, key) {
    const acc = await ctx.stub.getState(key);
    return acc && acc.length > 0;
  }

  async GetIdentity(ctx) {
    let org = ctx.clientIdentity.getMSPID();
    let ID = ctx.clientIdentity.getID();
    let IDBytes = ctx.clientIdentity.getIDBytes();

    let secureContext = tls.createSecureContext({
      cert: uint8arrayToStringMethod(IDBytes)
    });
    let secureSocket = new tls.TLSSocket(new net.Socket(), { secureContext });
    let cert = secureSocket.getCertificate();
    //console.log(cert)
    let pubkey = cert.pubkey.toString('hex');

    return pubkey
  }

  async Deletekey(ctx, key) {
    const exists = await this.UserAccControlExist(ctx, key);
    if (!exists) {
      throw new Error(`The key ${key} does not exist`);
    }
    return ctx.stub.deleteState(key);
  }

  async UpdatePermission(ctx, userPubkey, attribute, endTime) {
    let acc = await ctx.stub.getState(userPubkey);
    let accJson =
    {
      Permission: {}
    };

    if (acc && acc.length > 0) {
      accJson = JSON.parse(acc.toString());
    }

    if (!accJson.Permission) {
      accJson.Permission = {};
    }

    let attJson;
    // console.log(attribute);
    try {
      attJson = JSON.parse(attribute.toString());
    } catch (error) {
      console.log(attribute.toString());
      attJson = attribute;
    }


    Object.keys(attJson).forEach(async key => {
      // console.log(`${key} : ${attribute[key]}`);

      accJson.Permission[key] = {
        "access": attJson[key],
        "endTime": endTime
      };
    })

    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(accJson)));
    return "Update Permission successfully." + userPubkey;
  }

  // async UpdateOnePermission(ctx, userPubkey, attribute, permit, endTime) {
  //   let acc = await ctx.stub.getState(userPubkey);
  //   let accJson =
  //   {
  //     Permission: {}
  //   };

  //   if (acc && acc.length > 0) {
  //     accJson = JSON.parse(acc.toString());
  //   }

  //   if (!accJson.Permission) {
  //     accJson.Permission = {};
  //   }

  //   accJson.Permission[attribute] = {
  //     "access": permit,
  //     "endTime": endTime
  //   };

  //   await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(accJson)));
  //   return "Update Permission successfully." + userPubkey;
  // }

  async RevokePermission(ctx, userPubkey, attribute) {
    let acc = await ctx.stub.getState(userPubkey);

    if (!acc || acc.length === 0) {
      throw new Error(`The user acc key:${userPubkey} does not exist`);
    }

    let accJson = JSON.parse(acc.toString());

    if (accJson.Permission &&
      accJson.Permission[attribute]) {
      delete accJson.Permission[attribute];
    }

    await ctx.stub.putState(userPubkey, Buffer.from(JSON.stringify(accJson)));
    return "Permission revoked successfully.";
  }

  async GetPermission(ctx, userPubkey, reviewerKey) {
    let acc = await ctx.stub.getState(userPubkey);
    if (!acc || acc.length === 0) {
      throw new Error(`The user acc key:${userPubkey} does not exist`);
    }
    let accJson = JSON.parse(acc.toString());
    const permissions = accJson.Permission;
    if (!permissions) {
      throw new Error(`permission denied!`);
    }
    return JSON.stringify(permissions);
  }

  // async ConfirmPermission(ctx, userPubkey, attribute) {
  //   let acc = await ctx.stub.getState(userPubkey);

  //   if (acc && acc.length) {
  //     try {
  //       let accJson = JSON.parse(acc.toString());
  //       const permissions = accJson.Permission;
  //       if (permissions.hasOwnProperty(key) && permissions.key.access == "true") {
  //         return true;
  //       }
  //     } catch (error) {
  //       return false;
  //     }
  //   }
  //   else {
  //     return false;
  //   }
  // }

  // async ConfirmMutiPermission(ctx, userPubkey, attributes) {
  //   let acc = await ctx.stub.getState(userPubkey);
  //   let permit = {};
  //   if (acc && acc.length) {
  //     let attJson;
  //     // console.log(attribute);
  //     try {
  //       attJson = JSON.parse(attributes.toString());
  //     } catch (error) {
  //       console.log(attributes.toString());
  //       attJson = attributes;
  //     }

  //     try {
  //       let accJson = JSON.parse(acc.toString());
  //       const permissions = accJson.Permission;

  //       Object.keys(attJson).forEach(async key => {
  //         // console.log(`${key} : ${attribute[key]}`);
  //         if (permissions.hasOwnProperty(key) && permissions.key.access == "true") {
  //           permit.key = true;
  //         }
  //         else {
  //           permit.key = false;
  //         }

  //       })

  //     } catch (error) {
  //       throw new Error(`permission denied! ${error}`);
  //     }
  //   }
  //   return JSON.stringify(permit);
  // }
}
exports.contracts = [AccessControlManager];