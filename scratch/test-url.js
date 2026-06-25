const axios = require('axios');

async function testDownloadLink() {
  const url = 'https://moviezon-api.onrender.com/api/v2/stream/proxy?token=7fc81bd87c08d91880ace2dc29ec1a6a%3A810ccef9c6b52eadc0632d9a9f8f1c80a4b32973de8a206a2a4512d5eccc3ea3a09e5dd7e16163d32b335cb7b929cd7f283a35fbb78f2af23ffcdacb6949e0de4ea30b605ac90ec2616dca7daa4c122d1ce0d895d237b35d6ff7122385bb369ce62c5bab6328db3078195b4b5f8f73a10fd1de70e7e5e754fc0fc9b52a4fd32470efad152ed2307152e26c4afac33a4d32ca85deb9b2f971ff4c937e2ae396ddaa7a877b6def9cb10fc57da0935b5a8610dc30de78fde23d1dd6dc71d6df5d33ab859d72cb2574b0377f11e911f60de83df4e128c39ee9c1cbe1221fa2db3ea429b90ee3709d44cdd675d24aefc70d5affc637ed1bfce22d25754f69102097a7478dd7539c06ba583611ae4ff52fc0f6bc2c11d8ead232703622cd13f80e65c3a2d62e329ddf5a20c3e74275baeb95372e01638edc0e180bea5ff8dcdf13c4934eee1a7b154c0376affd2f8ae54b6b8b9e3f61262df6d37bbfc52d2687533d900bca86ab7f367421f11cfd1484c24dcfa3bb5946be8a089087af46cf8e581885a344909b059466fe4f9a9bac9f00417156ff5ad46acc7940b9e6a7a6c7ab6dc942bf888f9d2f8bce442fb7599a770bd4a24becfae3051e81600add97680b34f07ffdea23f4b5d050e0d05c1431ef6516d2f2d8dafecae8a207e4df3f7b30608f42753eec69b76aa831a1f816e8e7dcb6417f8907386ce8d555c60def49596023935f42d8e754f3e2788907344ab6d23da65df2ff97957f6752f461823374e40569801a06adf83a803d9d0d07076d123924a29fdd0eafc8abb8a4d2f93b53f8fc0182feefc0f071f4d7346289d4b66549b423ffeda7803d9ff746367596df2adc29a4e34e62c29b7a0ea459f339608892e9ae1b567ecaadc7f06e4e223605d70e90772fbfae44854fc981b7fca0d47dc15d22cbac3548325e070706f63a2bdcae958951b379906c8c13493226727eef715df4906507e5e0578a47f6ef5311d20b72dcc28fd01f221728106cac14a23a38ce1ecabfc625843ef8391d4a749a49cf148450102cd96cf8737ef8844ed11e05deae160e1a095d999f2e489a7c55f8a28cbbdba58273f2ecad4624672d0c4fbb&download=true';
  console.log(`Sending GET request to proxy link...`);
  try {
    const res = await axios.get(url, { 
      timeout: 15000, 
      responseType: 'arraybuffer',
      validateStatus: false
    });
    console.log("Status:", res.status);
    console.log("Headers:", res.headers);
    const bodyStr = Buffer.from(res.data).toString('utf8');
    console.log("Body preview (first 500 chars):", bodyStr.slice(0, 500));
  } catch (err) {
    console.log("Error:", err.message);
  }
}

testDownloadLink();
