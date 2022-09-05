/**
 * Parses a 'multipart/form-data' upload request
 *
 * @param {Object} req Cloud Function request context.
 * @param {Object} res Cloud Function response context.
 */
const path = require("path");
const os = require("os");
const fs = require("fs");
const functions = require("firebase-functions");
const axios = require("axios");
const FormData = require('form-data');

// Node.js doesn't have a built-in multipart/form-data parsing library.
// Instead, we can use the 'busboy' library from NPM to parse these requests.
const Busboy = require("busboy");

exports.uploadFile = (req, res) => {
  // Set CORS headers for preflight requests
  // Allows GETs from any origin with the Content-Type header
  // and caches preflight response for 3600s

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') {
    // Send response to OPTIONS requests
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Max-Age', '3600');
    res.status(204).send('');
  } else {
    if (!req.get("Authorization")) {
      res.status(401).send("Missing auth token");
    }
    const token = req.get("Authorization").split("Bearer ")[1];
    functions.logger.info("Bearer token: " + token);

    let dxbSuccess = false;
    let dxbRes;
    let sgSuccess = false;
    let sgRes;
    let filepath;
    
    const busboy = Busboy({headers: req.headers});
    const tmpdir = os.tmpdir();

    // This object will accumulate all the fields, keyed by their name
    const fields = {};

    // This object will accumulate all the uploaded files, keyed by their name.
    const uploads = {};

    // This code will process each non-file field in the form.
    busboy.on("field", (fieldname, val) => {
      /**
       *  TODO(developer): Process submitted field values here
       */
      functions.logger.info(`Processed field ${fieldname}: ${val}.`);
      fields[fieldname] = val;
    });

    const fileWrites = [];

    // This code will process each file uploaded.
    busboy.on("file", (fieldname, file, {filename}) => {
      // Note: os.tmpdir() points to an in-memory file system on GCF
      // Thus, any files in it must fit in the instance's memory.
      functions.logger.info(`Processed file ${filename}`);
      filepath = path.join(tmpdir, filename);
      uploads[fieldname] = filepath;

      const writeStream = fs.createWriteStream(filepath);
      file.pipe(writeStream);

      // File was processed by Busboy; wait for it to be written.
      // Note: GCF may not persist saved files across invocations.
      // Persistent files must be kept in other locations
      // (such as Cloud Storage buckets).
      const promise = new Promise((resolve, reject) => {
        file.on("end", () => {
          writeStream.end();
        });
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
      fileWrites.push(promise);
    });
    const formSG = new FormData();
    const formSGHeaders = formSG.getHeaders();
    const headersSG = Object.assign({
        "Authorization": "Bearer " + token,
      }, formSGHeaders);
    const configSG = {
      headers: headersSG,
      "validateStatus": false,
    };
    const formDXB = new FormData();
    const formDXBHeaders = formDXB.getHeaders();
    const headersDXB = Object.assign({
        "Authorization": "Bearer " + token,
      }, formDXBHeaders);
    const configDXB = {
      headers: headersDXB,
      "validateStatus": false,
    };
    // Triggered once all uploaded files are processed by Busboy.
    // We still need to wait for the disk writes (saves) to complete.
    busboy.on("finish", async () => {
      await Promise.all(fileWrites);

      /**
       * TODO(developer): Process saved files here
       */
      for (const file in uploads) {
        if (Object.prototype.hasOwnProperty.call(uploads, file)) {
          formSG.append('avatar', fs.createReadStream(filepath));
          formDXB.append('avatar', fs.createReadStream(filepath));
          const editDXB = async () => {
            functions.logger.info("DXB form:\n", formDXB);
            functions.logger.info("DXB config:\n", configDXB);
            return await axios
                .post("https://api.fiduproperty.com/api/users/me/updateUserPhoto?_method=put", formDXB, configDXB)
                .then((response) => {
                  functions.logger.info("Updating DXB User photo...");
                  functions.logger.info("DXB photo update result:", response.data);
                  // response.status(res.status).send(res.data);
                  if (response.status == 200) {
                    functions.logger.info("DXB photo update success!");
                    dxbSuccess = true;
                    dxbRes = response.data;
                    return "Success";
                  } else {
                    functions.logger.info("DXB photo update failed...");
                    functions.logger.info("DXB: " + response.status, response.data);
                    throw new Error(response.data);
                  }
                })
                .catch((error) => {
                  functions.logger.error(error);
                  return "Failed";
                });
          };
          const editSG = async () => {
            functions.logger.info("SG form:\n", formSG);
            functions.logger.info("SG config:\n", configSG);
            return await axios
                .post("https://api.fidu.sg/api/users/me/updateUserPhoto?_method=put", formSG, configSG)
                .then((response) => {
                  functions.logger.info("Updating SG User photo...");
                  functions.logger.info("SG photo update result:", response.data);
                  if (response.status == 200) {
                    functions.logger.info("SG photo update success!");
                    sgSuccess = true;
                    sgRes = response.data;
                    return "Success"
                  } else {
                    functions.logger.info("SG photo update failed...");
                    functions.logger.info("SG: " + response.status, response.data);
                    throw new Error(response.data);
                  }
                })
                .catch((error) => {
                  functions.logger.error(error);
                  return "Failed";
                });
          };
          // await editDXB();
          // functions.logger.info("DXB done, moving to SG...");
          // await editSG();
          Promise.allSettled([editDXB(), editSG()]).then(function(values) {
            functions.logger.info(values);
            if (values[0].value == "Success" && values[1].value == "Success") {
              if (dxbRes) {
                functions.logger.info("Sending DXB photo response");
                res.status(200).send(dxbRes);
                fs.unlinkSync(uploads[file]);
              } else if (sgRes) {
                functions.logger.info("Sending SG photo response");
                res.status(200).send(sgRes);
                fs.unlinkSync(uploads[file]);
              }
            } else {
              functions.logger.info("Something went wrong...");
              if (dxbRes) {
                res.status(500).send("Image upload failed on SG");
              } else if (sgRes) {
                res.status(500).send("Image upload failed on DXB");
              } else {
                res.status(500).send("Image upload failed");
              }
              fs.unlinkSync(uploads[file]);
            }
          });
        }
      }
    });

    busboy.end(req.rawBody);
  }
};
