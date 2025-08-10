import express from "express";
import { prisma } from "@repo/db/client";

import {client} from "@repo/redis/client"

const app = express();

app.get("/", (req, res) => {
  res.json({
    message: "we back",
  });
});

app.listen(8080, () => {
  console.log("Listening on port 8080");
});
