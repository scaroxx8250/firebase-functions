const functions = require("firebase-functions");
// const admin = require("firebase-admin");
// admin.initializeApp();
const axios = require("axios");

exports.createWPuser = functions.https.onRequest(async (request, response) => {
  // Set CORS headers for preflight requests
  // Allows GETs from any origin with the Content-Type header
  // and caches preflight response for 3600s

  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (request.method === 'OPTIONS') {
    // Send response to OPTIONS requests
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Access-Control-Max-Age', '3600');
    response.status(204).send('');
  } else {
    // Handle actual request
    if (!request.get("Authorization")) {
      response.status(401).send("Missing auth token");
    }
    const token = request.get("Authorization").split("Bearer ")[1];
    let dxbSuccess = false;
    let dxbRes;
    let sgSuccess = false;
    let sgRes;
    functions.logger.info("Bearer token: " + token);
    functions.logger.info("Request body:\n" + JSON.stringify(request.body));
      const auth = {
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token,
        },
        "validateStatus": false,
      };
    const createDXB = async () => {
      await axios
          .post("https://api.fiduproperty.com/api/users", request.body, auth)
          .then((res) => {
            functions.logger.info("Creating User on DXB...");
            functions.logger.info("DXB user creation result:");
            functions.logger.info(res.data);
            // response.status(res.status).send(res.data);
            if (res.status == 200) {
              functions.logger.info("DXB user creation success!");
              dxbSuccess = true;
              dxbRes = res.data;
            } else {
              functions.logger.info("DXB user creation failed...");
              response.status(res.status).send(res.data);
              response.end();
            }
          })
          .catch((error) => {
            functions.logger.error(error);
            response.status(501).send(error);
          });
    };
    await createDXB();
    const createSG = async () => {
      await axios
          .post("https://api.fidu.sg/api/users", request.body, auth)
          .then((res) => {
            functions.logger.info("Creating User on SG...");
            functions.logger.info("SG user creation result:");
            functions.logger.info(res.data);
            if (res.status == 200) {
              functions.logger.info("SG user creation success!");
              sgSuccess = true;
              sgRes = res.data;
            } else {
              functions.logger.info("SG user creation failed...");
              response.status(res.status).send(res.data);
              response.end();
            }
          })
          .catch((error) => {
            functions.logger.error(error);
            response.status(501).send(error);
          });
    };
    await createSG();
    if (dxbRes) {
      functions.logger.info("Sending DXB user data");
      response.status(200).send(dxbRes);
    } else if (sgRes) {
      functions.logger.info("Sending SG user data");
      response.status(200).send(sgRes);
    } else {
      functions.logger.info("Somehow we reached this point");
      response.status(500).send("Something unexpected occurred...");
    }
  }
});
