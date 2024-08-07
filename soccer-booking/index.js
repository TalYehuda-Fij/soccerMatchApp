const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const pool = require('./db');
const apolloServer = require('./graphql');
const swaggerSetup = require('./swagger');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticateJWT, authorizeRoles } = require('./auth');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 5000;


app.use(bodyParser.json());
app.use(cors());
require('dotenv').config();

const saltRounds = 10;

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(saltRounds);
  const hashedPassword = await bcrypt.hash(password, salt);
  return hashedPassword;
};

const comparePassword = async (plainPassword, hashedPassword) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};


// Swagger setup
swaggerSetup(app);

apolloServer.start().then(() => {
  apolloServer.applyMiddleware({ app });



  // const limiter = rateLimit({
  //   windowMs: 15 * 60 * 1000,
  //   max: 100,
  //   message: 'Too many requests, please try again later.',
  // });
  
  // app.use(limiter);
  const generateAccessToken = (user) => {
    return jwt.sign({ id: user.id, role: user.role, username: user.username }, process.env.JWT_SECRET, { expiresIn: '1h' });
  };

  app.post('/login', async (req, res) => {
    const { email, password } = req.body;
  
    try {
      const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0];
  
      if (!user) {
        return res.status(400).send('Invalid email or password.');
      }
  
      const validPassword = await comparePassword(password, user.password);
  
      if (!validPassword) {
        return res.status(400).send('Invalid email or password.');
      }
  
      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET, {
        expiresIn: '1h',
      });
  
      res.json({ token });
    } catch (err) {
      console.error('Login error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  /**
   * @swagger
   * components:
   *   schemas:
   *     User:
   *       type: object
   *       required:
   *         - username
   *         - email
   *         - password
   *         - role
   *       properties:
   *         id:
   *           type: integer
   *           description: The auto-generated id of the user
   *         username:
   *           type: string
   *         email:
   *           type: string
   *         password:
   *           type: string
   *         role:
   *           type: string
   *         skill_level:
   *           type: integer
   *       example:

   *         username: john_doe
   *         email: john@example.com
   *         password: password123
   *         role: player
   *         skill_level: 3
   *     Match:
   *       type: object
   *       required:
   *         - date
   *         - time
   *         - location
   *       properties:
   *         id:
   *           type: integer
   *           description: The auto-generated id of the match
   *         date:
   *           type: string
   *           format: date
   *         time:
   *           type: string
   *           format: time
   *         location:
   *           type: string
   *       example:
   *         id: 1
   *         date: 2024-08-01
   *         time: 15:00:00
   *         location: Local Stadium
   *     Booking:
   *       type: object
   *       required:
   *         - user_id
   *         - match_id
   *         - status
   *       properties:
   *         id:
   *           type: integer
   *           description: The auto-generated id of the booking
   *         user_id:
   *           type: integer
   *         match_id:
   *           type: integer
   *         status:
   *           type: string
   *       example:
   *         id: 1
   *         user_id: 1
   *         match_id: 1
   *         status: booked
   */

  /**
   * @swagger
   * tags:
   *   name: Users
   *   description: User management
   */

  /**
   * @swagger
   * /users:
   *   get:
   *     summary: Returns the list of all the users
   *     tags: [Users]
   *     responses:
   *       200:
   *         description: The list of the users
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/User'
   */
  app.get('/users', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const { username, email } = req.query;
    
      let query = 'SELECT * FROM users WHERE 1=1';
      let params = [];
    
      if (username) {
        params.push(`%${username}%`);
        query += ` AND username ILIKE $${params.length}`;
      }
    
      if (email) {
        params.push(`%${email}%`);
        query += ` AND email ILIKE $${params.length}`;
      }
    
      params.push(limit, offset);
      query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
    
      try {
        const result = await pool.query(query, params);
        const totalResult = await pool.query('SELECT COUNT(*) FROM users WHERE 1=1');
        const total = totalResult.rows[0].count;
        res.json({
          users: result.rows,
          total,
          page,
          pages: Math.ceil(total / limit),
        });
      } catch (err) {
        console.error('Query error:', err.message);
        res.status(500).send('Server error: ' + err.message);
      }
  });

  /**
   * @swagger
   * /users:
   *   post:
   *     summary: Create a new user
   *     tags: [Users]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/User'
   *     responses:
   *       200:
   *         description: The created user.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/User'
   *       500:
   *         description: Some server error
   */
  app.post('/users', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
    try {
      const { username, email, password, role, skill_level } = req.body;
      const hashedPassword = bcrypt.hashSync(password, 10);
      const newUser = await pool.query(
        'INSERT INTO users (username, email, password, role, skill_level) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [username, email, hashedPassword, role, skill_level || 0]
      );
      res.json(newUser.rows[0]);
    } catch (err) {
      console.error('Insertion error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  /**
   * @swagger
   * tags:
   *   name: Matches
   *   description: Match management
   */

  /**
   * @swagger
   * /matches:
   *   get:
   *     summary: Returns the list of all the matches
   *     tags: [Matches]
   *     responses:
   *       200:
   *         description: The list of the matches
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Match'
   */
  app.get('/matches', authenticateJWT, async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM matches WHERE date >= CURRENT_DATE');
      res.json(result.rows);
    } catch (err) {
      console.error('Query error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  /**
   * @swagger
   * /matches:
   *   post:
   *     summary: Create a new match
   *     tags: [Matches]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/Match'
   *     responses:
   *       200:
   *         description: The created match.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Match'
   *       500:
   *         description: Some server error
   */
  app.post('/matches', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
    try {
      const { date, time, location } = req.body;
      const newMatch = await pool.query(
        'INSERT INTO matches (date, time, location) VALUES ($1, $2, $3) RETURNING *',
        [date, time, location]
      );
      res.json(newMatch.rows[0]);
    } catch (err) {
      console.error('Insertion error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  /**
   * @swagger
   * tags:
   *   name: Bookings
   *   description: Booking management
   */

  /**
   * @swagger
   * /bookings:
   *   get:
   *     summary: Returns the list of all the bookings
   *     tags: [Bookings]
   *     responses:
   *       200:
   *         description: The list of the bookings
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 $ref: '#/components/schemas/Booking'
   */
  app.get('/bookings', authenticateJWT, async (req, res) => {
    try {
      const user_id = req.user.id;
      const result = await pool.query('SELECT * FROM bookings WHERE user_id = $1', [user_id]);
      res.json(result.rows);
    } catch (err) {
      console.error('Query error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  /**
   * @swagger
   * /bookings:
   *   post:
   *     summary: Create a new booking
   *     tags: [Bookings]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/Booking'
   *     responses:
   *       200:
   *         description: The created booking.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/Booking'
   *       500:
   *         description: Some server error
   */
  app.post('/bookings', authenticateJWT, async (req, res) => {
    try {
      const user_id = req.user.id; // Extract user_id from the authenticated user
      const { match_id, status } = req.body;
  
      const existingBookingResult = await pool.query(
        'SELECT * FROM bookings WHERE user_id = $1 AND match_id = $2',
        [user_id, match_id]
      );
  
      if (existingBookingResult.rows.length > 0) {
        return res.status(400).json({ error: 'User is already booked for this match' });
      }
  
      const bookingCountResult = await pool.query(
        'SELECT COUNT(*) FROM bookings WHERE match_id = $1',
        [match_id]
      );
      const bookingCount = parseInt(bookingCountResult.rows[0].count, 10);
  
      if (bookingCount >= 18) {
        return res.status(400).json({ error: 'Maximum number of players for this match has been reached' });
      }
  
      const newBooking = await pool.query(
        'INSERT INTO bookings (user_id, match_id, status) VALUES ($1, $2, $3) RETURNING *',
        [user_id, match_id, status]
      );
      res.json(newBooking.rows[0]);
    } catch (err) {
      console.error('Insertion error:', err.message);
      res.status(500).send('Server error: ' + err.message);
    }
  });

  // Update a user
/**
 * @swagger
 * /users/{id}:
 *   put:
 *     summary: Update a user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The user id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       200:
 *         description: The updated user.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       500:
 *         description: Some server error
 */
app.put('/users/:id', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, password, role, skill_level } = req.body;
    const hashedPassword = bcrypt.hashSync(password, 10);
    const updatedUser = await pool.query(
      'UPDATE users SET username = $1, email = $2, password = $3, role = $4, skill_level = $5 WHERE id = $6 RETURNING *',
      [username, email, hashedPassword, role, skill_level, id]
    );
    res.json(updatedUser.rows[0]);
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});
// Delete a user
/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     summary: Delete a user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The user id
 *     responses:
 *       200:
 *         description: The user was deleted successfully.
 *       500:
 *         description: Some server error
 */
app.delete('/users/:id', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Deletion error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Update a match
/**
 * @swagger
 * /matches/{id}:
 *   put:
 *     summary: Update a match
 *     tags: [Matches]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The match id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Match'
 *     responses:
 *       200:
 *         description: The updated match.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Match'
 *       500:
 *         description: Some server error
 */
app.put('/matches/:id', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { date, time, location } = req.body;
    const updatedMatch = await pool.query(
      'UPDATE matches SET date = $1, time = $2, location = $3 WHERE id = $4 RETURNING *',
      [date, time, location, id]
    );
    res.json(updatedMatch.rows[0]);
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Delete a match
/**
 * @swagger
 * /matches/{id}:
 *   delete:
 *     summary: Delete a match
 *     tags: [Matches]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The match id
 *     responses:
 *       200:
 *         description: The match was deleted successfully.
 *       500:
 *         description: Some server error
 */
app.delete('/bookings/:match_id', authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { match_id } = req.params;

    const deleteResult = await pool.query(
      'DELETE FROM bookings WHERE user_id = $1 AND match_id = $2 RETURNING *',
      [user_id, match_id]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found or user is not signed up for this match' });
    }

    res.json({ message: 'Successfully unsigned from the match' });
  } catch (err) {
    console.error('Deletion error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Update a booking
/**
 * @swagger
 * /bookings/{id}:
 *   put:
 *     summary: Update a booking
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The booking id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Booking'
 *     responses:
 *       200:
 *         description: The updated booking.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Booking'
 *       500:
 *         description: Some server error
 */
app.put('/bookings/:id', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, match_id, status } = req.body;
    const updatedBooking = await pool.query(
      'UPDATE bookings SET user_id = $1, match_id = $2, status = $3 WHERE id = $4 RETURNING *',
      [user_id, match_id, status, id]
    );
    res.json(updatedBooking.rows[0]);
  } catch (err) {
    console.error('Update error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Delete a booking
/**
 * @swagger
 * /bookings/{id}:
 *   delete:
 *     summary: Delete a booking
 *     tags: [Bookings]
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: integer
 *         required: true
 *         description: The booking id
 *     responses:
 *       200:
 *         description: The booking was deleted successfully.
 *       500:
 *         description: Some server error
 */
app.delete('/bookings/:id', authenticateJWT, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
    res.json({ message: 'Booking deleted successfully' });
  } catch (err) {
    console.error('Deletion error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

// Allow users to unsign from a match
app.delete('/bookings/:match_id', authenticateJWT, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { match_id } = req.params;

    const deleteResult = await pool.query(
      'DELETE FROM bookings WHERE user_id = $1 AND match_id = $2 RETURNING *',
      [user_id, match_id]
    );

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: 'Booking not found or user is not signed up for this match' });
    }

    res.json({ message: 'Successfully unsigned from the match' });
  } catch (err) {
    console.error('Deletion error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

app.post('/signup', async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;

  // Enforce strong password policies
  if (!password || password.length < 8) {
    return res.status(400).send('Password must be at least 8 characters long.');
  }

  const hashedPassword = await hashPassword(password);

  try {
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING *',
      [username, email, hashedPassword, role]
    );
    res.json(newUser.rows[0]);
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});

app.get('/matches-with-players', authenticateJWT, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        matches.id as match_id,
        matches.date,
        matches.time,
        matches.location,
        users.username
      FROM matches
      LEFT JOIN bookings ON matches.id = bookings.match_id
      LEFT JOIN users ON bookings.user_id = users.id
      WHERE matches.date >= CURRENT_DATE
    `);

    const matches = result.rows.reduce((acc, row) => {
      const { match_id, date, time, location, username } = row;
      const match = acc.find(m => m.id === match_id);
      if (match) {
        match.players.push(username);
      } else {
        acc.push({
          id: match_id,
          date,
          time,
          location,
          players: username ? [username] : []
        });
      }
      return acc;
    }, []);

    
    app.get('/matches-with-players', authenticateJWT, async (req, res) => {
      try {
        const result = await pool.query(`
          SELECT 
            matches.id as match_id,
            matches.date,
            matches.time,
            matches.location,
            users.username
          FROM matches
          LEFT JOIN bookings ON matches.id = bookings.match_id
          LEFT JOIN users ON bookings.user_id = users.id
          WHERE matches.date >= CURRENT_DATE
        `);
    
        const matches = result.rows.reduce((acc, row) => {
          const { match_id, date, time, location, username } = row;
          const match = acc.find(m => m.id === match_id);
          if (match) {
            match.players.push(username);
          } else {
            acc.push({
              id: match_id,
              date,
              time,
              location,
              players: username ? [username] : []
            });
          }
          return acc;
        }, []);
    
        res.json(matches);
      } catch (err) {
        console.error('Query error:', err.message);
        res.status(500).send('Server error: ' + err.message);
      }
    });

    
    // Create a new booking (accessible to both users and admins)
app.post('/bookings', authenticateJWT, async (req, res) => {
  const { match_id, status } = req.body;
  const user_id = req.user.id;

  try {
    const newBooking = await pool.query(
      'INSERT INTO bookings (match_id, user_id, status) VALUES ($1, $2, $3) RETURNING *',
      [match_id, user_id, status]
    );
    res.json(newBooking.rows[0]);
  } catch (err) {
    console.error('Insertion error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});



    res.json(matches);
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).send('Server error: ' + err.message);
  }
});



  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
