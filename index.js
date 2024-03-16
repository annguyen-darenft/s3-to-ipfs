import { readFileSync, writeFileSync } from "fs";
import { read, utils, write } from "xlsx/xlsx.mjs";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import FormData from "form-data";
import * as fs from "fs";
import * as util from "util";
import * as stream from "stream";
const pipeline = util.promisify(stream.pipeline);

import { NFT2Client } from "@darenft-labs/nft2-client";

const apiKey =
  "60531f70eb997d85f05c47d7363f1d8fb979dc4c433eed5cc6a532be5c213948";
const nft2Client = new NFT2Client(apiKey);

await nft2Client.initialize().then(() => {
  console.log("Client init success!");
});

const downloadFile = async (url) => {
  const filename = url.split("/").pop();
  const response = await axios.get(url, {
    responseType: "stream",
  });
  await pipeline(response.data, fs.createWriteStream(filename));
  return filename;
};

const generateFileName = (originalName) => {
  const array = originalName.split(".");
  let ext = "";
  if (array.length > 1) {
    ext = array[array.length - 1];
    array.pop();
  }
  array.push("-" + uuidv4());

  if (ext.length) {
    array.push("." + ext);
  }
  const name = array.join("");
  return name;
};

const getPresignedUrl = async (filename) => {
  const apiProtocol = nft2Client.getAPIService();

  const presignedList = await apiProtocol.generatePresignedImage({
    files: [
      {
        fileName: generateFileName(filename),
        mimeType: "image/png",
      },
    ],
  });

  return presignedList.urls[0];
};

const uploadToIPFS = async (filename, presignedUrl) => {
  const form_data = new FormData();
  form_data.append("file", fs.createReadStream(filename));

  const response = await axios.put(presignedUrl, form_data, {
    headers: {
      "Content-Type": "image/png", // mimeType
    },
  });

  const imageData = {
    image_name: filename,
    image_cid: response.headers?.["x-amz-meta-cid"], // CID of image on IPFS
  };

  return imageData;
};

const main = async () => {
  const buf = readFileSync("input.xlsx");
  const wb = read(buf);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data = utils.sheet_to_json(sheet);

  if (data.length <= 0) {
    throw new Error("File must have content");
  }
  if (data.length > 10000) {
    throw new Error("Number of lines exceeded, maximum length is 10000");
  }

  const result = [];

  const urlKey = sheet["A1"].v;
  for (let i = 0; i < data.length; i++) {
    const url = data[i][urlKey];
    if (!url) {
      continue;
    }
    console.log("process file: ", url);
    try {
      const filename = await downloadFile(url);
      const presignUrl = await getPresignedUrl(filename);
      const { image_name, image_cid } = await uploadToIPFS(
        filename,
        presignUrl
      );
      result.push({
        image_name,
        ipfs: "https://cloudflare-ipfs.com/ipfs/" + image_cid,
      });
      fs.unlink(filename, function (err) {
        if (err) throw err;
      });
    } catch (error) {
      console.log("error file ", url, error);
    }
  }
  const outputSheet = utils.json_to_sheet(result);
  const outputBook = utils.book_new();
  utils.book_append_sheet(outputBook, outputSheet, "Result");
  utils.sheet_add_aoa(outputSheet, [["File Name", "IPFS URI"]], {
    origin: "A1",
  });
  const resultBuf = write(outputBook, { type: "buffer", bookType: "xlsx" });
  writeFileSync("output.xlsx", resultBuf);

  console.log("done!");
};

main();
