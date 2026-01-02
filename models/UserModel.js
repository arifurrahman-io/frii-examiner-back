const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "teacher", "incharge"],
      default: "teacher",
    },
    // নতুন ফিল্ড: ইনচার্জ রোল হলে এটি কোন ক্যাম্পাসের তা নির্ধারণ করবে
    campus: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      required: function () {
        // যদি রোল 'incharge' হয়, তবে ক্যাম্পাস ফিল্ডটি বাধ্যতামূলক (Required)
        return this.role === "incharge";
      },
    },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", UserSchema);
