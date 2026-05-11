// server/config/db.js
const dns = require("dns");
const mongoose = require("mongoose");

const configureMongoDns = () => {
  const dnsServers = (
    process.env.MONGO_DNS_SERVERS || "1.1.1.1,8.8.8.8"
  )
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (process.env.MONGO_URI?.startsWith("mongodb+srv://") && dnsServers.length) {
    dns.setServers(dnsServers);
  }
};

const connectDB = async () => {
  try {
    configureMongoDns();
    await mongoose.connect(process.env.MONGO_URI);
    await ensureOptionalTeacherPhoneIndex();
    console.log("MongoDB successfully connected.");
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const ensureOptionalTeacherPhoneIndex = async () => {
  const teachers = mongoose.connection.collection("teachers");
  const indexes = await teachers.indexes();
  const phoneIndex = indexes.find((index) => index.name === "phone_1");

  if (
    phoneIndex &&
    phoneIndex.unique &&
    !phoneIndex.sparse &&
    !phoneIndex.partialFilterExpression
  ) {
    await teachers.dropIndex("phone_1");
  }

  const refreshedIndexes = await teachers.indexes();
  const hasPhoneIndex = refreshedIndexes.some((index) => index.name === "phone_1");

  if (!hasPhoneIndex) {
    await teachers.createIndex(
      { phone: 1 },
      {
        name: "phone_1",
        unique: true,
        partialFilterExpression: {
          phone: { $type: "string" },
        },
      }
    );
  }
};

module.exports = connectDB;
