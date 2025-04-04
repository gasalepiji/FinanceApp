import express from "express"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import helmet from "helmet" // Security middleware
import xss from "xss-clean" // Sanitize input
import hpp from "hpp" // Protect against HTTP Parameter Pollution
import rateLimit from "express-rate-limit" // Rate limiting
import { validationResult, body } from "express-validator" // Input validation

const app = express()
const PORT = 5000

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "https://cdn.tailwindcss.com", 
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com",
        "'unsafe-inline'"
      ],
      styleSrc: [
        "'self'", 
        "https://cdn.tailwindcss.com", 
        "https://cdn.jsdelivr.net", 
        "https://cdnjs.cloudflare.com", 
        "'unsafe-inline'"
      ],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
    },
  },
  xssFilter: true,
}))
app.use(xss()) // Sanitize inputs
app.use(hpp()) // Prevent parameter pollution

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
})
app.use("/api/", limiter)

// Middleware
app.use(express.json({ limit: '10kb' })) // Body parser with size limit
app.use(express.static("public"))

// Ensure data directory and file exist
const dataDir = path.join(__dirname, "data")
const dataFile = path.join(dataDir, "data.json")

function ensureDataFileExists() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  if (!fs.existsSync(dataFile)) {
    const initialData = {
      profile: {
        name: "Change with your name in server.js",
        balance: 0,
      },
      transactions: [],
    }
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2), "utf8")
  }
}

ensureDataFileExists()

// Helper function to read data
function readData() {
  try {
    const data = fs.readFileSync(dataFile, "utf8")
    return JSON.parse(data)
  } catch (error) {
    console.error("Error reading data file:", error)
    return null
  }
}

// Helper function to write data
function writeData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8")
    return true
  } catch (error) {
    console.error("Error writing to data file:", error)
    return false
  }
}

// Validation middleware for transactions
const validateTransaction = [
  body('type').trim().isIn(['income', 'expense']).withMessage('Type must be income or expense'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be a positive number'),
  body('category').trim().isLength({ min: 1, max: 50 }).escape().withMessage('Category is required'),
  body('description').trim().escape().optional(),
  body('date').isDate().withMessage('Valid date is required'),
]

// API Routes
app.get("/api/profile", (req, res) => {
  const data = readData()
  if (data) {
    res.json(data.profile)
  } else {
    res.status(500).json({ error: "Failed to read profile data" })
  }
})

app.get("/api/transactions", (req, res) => {
  const data = readData()
  if (data) {
    res.json(data.transactions)
  } else {
    res.status(500).json({ error: "Failed to read transactions data" })
  }
})

app.post("/api/transactions", validateTransaction, (req, res) => {
  // Check for validation errors
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }

  const { type, amount, category, description, date } = req.body

  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const newTransaction = {
    id: Date.now().toString(),
    type,
    amount: Number.parseFloat(amount),
    category,
    description: description || "",
    date,
  }

  // Update balance
  if (type === "income") {
    data.profile.balance += Number.parseFloat(amount)
  } else if (type === "expense") {
    data.profile.balance -= Number.parseFloat(amount)
  }

  data.transactions.push(newTransaction)

  if (writeData(data)) {
    res.status(201).json(newTransaction)
  } else {
    res.status(500).json({ error: "Failed to save transaction" })
  }
})

// Sanitized statistics endpoints
app.get("/api/statistics/daily", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const today = new Date().toISOString().split("T")[0]
  const todayExpenses = data.transactions
    .filter((t) => t.type === "expense" && t.date.startsWith(today))
    .reduce((sum, t) => sum + t.amount, 0)

  res.json({ date: today, totalExpense: todayExpenses })
})

app.get("/api/statistics/weekly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const weeklyTransactions = data.transactions.filter((t) => t.date >= oneWeekAgo)
  const weeklyIncome = weeklyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const weeklyExpense = weeklyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    startDate: oneWeekAgo,
    endDate: now.toISOString().split("T")[0],
    income: weeklyIncome,
    expense: weeklyExpense,
    net: weeklyIncome - weeklyExpense,
  })
})

app.get("/api/statistics/monthly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStr = month < 10 ? `0${month}` : `${month}`
  const monthPrefix = `${year}-${monthStr}`

  const monthlyTransactions = data.transactions.filter((t) => t.date.startsWith(monthPrefix))
  const monthlyIncome = monthlyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const monthlyExpense = monthlyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    year,
    month,
    income: monthlyIncome,
    expense: monthlyExpense,
    net: monthlyIncome - monthlyExpense,
  })
})

app.get("/api/statistics/yearly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const yearPrefix = `${year}-`

  const yearlyTransactions = data.transactions.filter((t) => t.date.startsWith(yearPrefix))
  const yearlyIncome = yearlyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const yearlyExpense = yearlyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    year,
    income: yearlyIncome,
    expense: yearlyExpense,
    net: yearlyIncome - yearlyExpense,
  })
})

app.get("/api/statistics/chart", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStr = month < 10 ? `0${month}` : `${month}`
  const monthPrefix = `${year}-${monthStr}`

  // Get all days in current month
  const daysInMonth = new Date(year, month, 0).getDate()
  const dailyData = []

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`
    const dateStr = `${monthPrefix}-${dayStr}`

    const dayTransactions = data.transactions.filter((t) => t.date === dateStr)
    const income = dayTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
    const expense = dayTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

    dailyData.push({
      date: dateStr,
      day,
      income,
      expense,
      net: income - expense,
    })
  }

  res.json(dailyData)
})

// Serve the HTML pages with appropriate security headers
const serveWithSecurityHeaders = (req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  })
  next()
}

app.use(serveWithSecurityHeaders)

// Serve the HTML pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"))
})

app.get("/income", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "income.html"))
})

app.get("/expense", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "expense.html"))
})

app.get("/weekly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "weekly.html"))
})

app.get("/monthly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "monthly.html"))
})

app.get("/yearly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "yearly.html"))
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send('Something went wrong!')
})

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
