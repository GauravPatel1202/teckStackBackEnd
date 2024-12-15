const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const cors = require('cors');
require('dotenv').config(); // To load environment variables

// Create MySQL database connection
const database = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'TeckStack',
    port: process.env.DB_PORT || 3306
});

const app = express();
app.use(cors());
app.use(express.json()); // Middleware to parse JSON request bodies
const port = process.env.PORT || 5000;

// Connect to the MySQL database
database.connect((err) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    return;
  }
  console.log('Connected to the MySQL database');
});


// Registration Route
app.post('/register', async (req, res) => {
  try {
    const { email, pin } = req.body;

    console.log('Register request received:', { email });

    // Input validation (basic)
    if (!email || !pin) {
      return res.status(400).json({ error: 'Email and PIN are required' });
    }

    // Check if the email is already registered
    const [existingUser] = await new Promise((resolve, reject) => {
      database.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
        if (err) {
          console.error('Error checking email:', err);
          return reject(err);
        }
        resolve(results);
      });
    });

    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash the PIN
    const hashedPin = await bcrypt.hash(pin, 10);

    // Insert new user
    await new Promise((resolve, reject) => {
      database.query('INSERT INTO users (email, pin) VALUES (?, ?)', [email, hashedPin], (err, results) => {
        if (err) {
          console.error('Error inserting user:', err);
          return reject(err);
        }
        resolve(results);
      });
    });

    res.status(200).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).json({ error: `Database error: ${error.message}` });
  }
});

// Login Route
app.post('/login', async (req, res) => {
  const { email, pin } = req.body;
  console.log(req.body)


  // Check if the email exists in the database
  database.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) {
      console.log(err)
      console.error('Error fetching user:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(400).json({ error: 'Invalid email or PIN' });
    }

    const user = results[0];

    // Compare the entered PIN with the stored hashed PIN
    const isPinValid = await bcrypt.compare(pin, user.pin);
    if (!isPinValid) {
      return res.status(400).json({ error: 'Invalid email or PIN' });
    }

    res.status(200).json({ message: 'Login successful' });
  });
});

app.get('/api/courses', (req, res) => {
  const { search } = req.query; // Retrieve the search query parameter

  console.log(search);
  let query = 'SELECT * FROM subjects WHERE status = ?'; // Default query to get all "Active" courses
  const params = ['Active']; // Include "Active" as a default parameter for the status

  // If a search term is provided, modify the query to filter by name (or other fields if needed)
  if (search && search.trim()) {  // Ensure search is not empty or just spaces
    query += ' AND name LIKE ?'; // Add the placeholder for the search term
    params.push(`%${search}%`); // Add the search term wrapped in '%' for the LIKE query
  }

  // Execute the query with the parameters
  database.query(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Error fetching courses', error: err });
    } else {
      console.log(rows);
      res.json(rows);
    }
  });
});



app.get('/api/questions', (req, res) => {
  const { subject_id, page = 1, limit = 10 } = req.query; // Retrieve subject_id, page, and limit from query parameters
  const offset = (page - 1) * limit; // Calculate the offset for pagination
  
  console.log(`Fetching questions for subject_id: ${subject_id}, page: ${page}, limit: ${limit}`);

  // Start building the base query
  let query = `
      SELECT q.question_id, q.title, q.content,q.difficulty,q.answer,q.code, s.name AS subject, GROUP_CONCAT(t.name) AS tags
      FROM questions q
      JOIN subjects s ON q.subject_id = s.subject_id
      LEFT JOIN question_tags qt ON qt.question_id = q.question_id
      LEFT JOIN tags t ON qt.tag_id = t.tag_id
  `;

  const params = [];

  // If a subject_id is provided, add a WHERE clause
  if (subject_id) {
    query += ` WHERE q.subject_id = ?`;
    params.push(subject_id);
  }

  // Group by question_id to handle GROUP_CONCAT
  query += ` GROUP BY q.question_id`;

  // Add pagination (LIMIT and OFFSET)
  query += ` LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset)); // Add limit and offset to params

  // Execute the query with the parameters
  database.query(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Error fetching questions', error: err });
    } else {
      console.log(rows);
      res.json(rows);
    }
  });
});

app.delete('/api/questions/:id', (req, res) => {
  const { id } = req.params;

  const query = 'DELETE FROM questions WHERE question_id = ?';

  database.query(query, [id], (err, result) => {
    if (err) {
      res.status(500).json({ message: 'Error deleting question', error: err });
    } else if (result.affectedRows === 0) {
      res.status(404).json({ message: 'Question not found' });
    } else {
      res.json({ message: 'Question deleted successfully' });
    }
  });
});

// Update an existing question
app.put('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, subject_id, difficulty, answer, code } = req.body;

  const query = `
    UPDATE questions
    SET title = ?, content = ?, subject_id = ?, difficulty = ?, answer = ?, code = ?
    WHERE question_id = ?
  `;
  const values = [title, content, subject_id, difficulty, answer, code, id];

  database.query(query, values, (err, result) => {
    if (err) {
      res.status(500).json({ message: 'Error updating question', error: err });
    } else if (result.affectedRows === 0) {
      res.status(404).json({ message: 'Question not found' });
    } else {
      res.json({ message: 'Question updated successfully' });
    }
  });
});

// Create multiple questions (bulk insert)
app.post('/api/questions', (req, res) => {
  const questions = req.body; // Expect an array of questions

  // Ensure the request body is an array of objects with the required fields
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ message: 'Request body must be an array of questions' });
  }

  // Prepare values for bulk insert
  const query = `
    INSERT INTO questions (title, content, subject_id, difficulty, answer, code)
    VALUES ?
  `;
  
  const values = questions.map(question => [
    question.title,
    question.content,
    question.subject_id,
    question.difficulty || null, // Default to null if not provided
    question.answer || null,      // Default to null if not provided
    question.code || null         // Default to null if not provided
  ]);

  database.query(query, [values], (err, result) => {
    if (err) {
      return res.status(500).json({ message: 'Error creating questions', error: err });
    } else {
      return res.status(201).json({
        message: `${result.affectedRows} questions created successfully`,
        inserted_ids: result.insertId, // Only works for MySQL with AUTO_INCREMENT
      });
    }
  });
});



// Get a single question by ID
app.get('/api/questions/:id', (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT q.question_id, q.title, q.content, q.difficulty, q.answer, q.code, s.name AS subject
    FROM questions q
    JOIN subjects s ON q.subject_id = s.subject_id
    WHERE q.question_id = ?
  `;

  database.query(query, [id], (err, rows) => {
    if (err) {
      res.status(500).json({ message: 'Error fetching question', error: err });
    } else if (rows.length === 0) {
      res.status(404).json({ message: 'Question not found' });
    } else {
      res.json(rows[0]);
    }
  });
});



// Basic route for testing the server
app.get('/', (req, res) => {
  res.send('Hello from Express and MySQL');
});

// Start the Express server
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on ${port}`);
});
