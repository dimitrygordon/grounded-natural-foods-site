const express = require("express");

// CORS
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? ["https://groundedmarket.com"]
    : ["http://localhost:3000"];

app.use(
  cors({
    origin: allowedOrigins,
  })
);

const app = express();

const jobs = new Map(); // jobId -> data

// app.use(express.raw({ type: "*/*", limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));

let jobCounter = 0;

// Allow posting raw data to the job map
app.post("/submit", (req, res) => {
  const jobId = "job_" + ++jobCounter;
  jobs.set(jobId, req.body);
  console.log(req.body);
  res.json({ jobId });
});

// Remove a job and send its data
app.get("/poll", (req, res) => {
  if (jobs.size > 0) {
    const [jobId, data] = jobs.entries().next().value;
    console.log(data);
    jobs.delete(jobId);
    res.set("Content-Type", "application/json");
    res.send(data);
  } else {
    res.status(204).send();
  }
});

app.listen(3001);
