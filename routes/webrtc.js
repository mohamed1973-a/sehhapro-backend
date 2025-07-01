const express = require('express')
const router = express.Router()
const logger = require('../middleware/logger')

// Store active connections and rooms
const rooms = new Map()
const connections = new Map()

// WebSocket upgrade handler
router.ws('/signaling/:roomCode', (ws, req) => {
  const { roomCode } = req.params
  const connectionId = req.headers['x-connection-id'] || Date.now().toString()

  logger.info(`WebRTC: New connection ${connectionId} joining room ${roomCode}`)

  // Store connection
  connections.set(connectionId, {
    ws,
    roomCode,
    userId: req.headers['x-user-id'],
    userRole: req.headers['x-user-role']
  })

  // Initialize room if it doesn't exist
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      participants: new Map(),
      offers: new Map(),
      answers: new Map(),
      iceCandidates: new Map()
    })
  }

  const room = rooms.get(roomCode)
  room.participants.set(connectionId, {
    ws,
    userId: req.headers['x-user-id'],
    userRole: req.headers['x-user-role']
  })

  // Send room info to the new participant
  ws.send(JSON.stringify({
    type: 'room-info',
    roomCode,
    participantCount: room.participants.size,
    participants: Array.from(room.participants.values()).map(p => ({
      userId: p.userId,
      userRole: p.userRole
    }))
  }))

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message)
      handleSignalingMessage(roomCode, connectionId, data)
    } catch (error) {
      logger.error(`WebRTC: Error parsing message: ${error.message}`)
    }
  })

  // Handle connection close
  ws.on('close', () => {
    logger.info(`WebRTC: Connection ${connectionId} left room ${roomCode}`)
    
    // Remove from room
    if (room.participants.has(connectionId)) {
      room.participants.delete(connectionId)
    }

    // Remove from connections
    connections.delete(connectionId)

    // Notify other participants
    room.participants.forEach((participant, id) => {
      if (id !== connectionId && participant.ws.readyState === 1) {
        participant.ws.send(JSON.stringify({
          type: 'participant-left',
          connectionId
        }))
      }
    })

    // Clean up empty rooms
    if (room.participants.size === 0) {
      rooms.delete(roomCode)
      logger.info(`WebRTC: Room ${roomCode} cleaned up`)
    }
  })

  // Handle errors
  ws.on('error', (error) => {
    logger.error(`WebRTC: Connection error: ${error.message}`)
  })
})

// Handle signaling messages
function handleSignalingMessage(roomCode, senderId, data) {
  const room = rooms.get(roomCode)
  if (!room) return

  switch (data.type) {
    case 'offer':
      // Store offer and forward to other participants
      room.offers.set(senderId, data.offer)
      room.participants.forEach((participant, id) => {
        if (id !== senderId && participant.ws.readyState === 1) {
          participant.ws.send(JSON.stringify({
            type: 'offer',
            offer: data.offer,
            senderId
          }))
        }
      })
      break

    case 'answer':
      // Store answer and forward to the offer sender
      room.answers.set(senderId, data.answer)
      const targetParticipant = room.participants.get(data.targetId)
      if (targetParticipant && targetParticipant.ws.readyState === 1) {
        targetParticipant.ws.send(JSON.stringify({
          type: 'answer',
          answer: data.answer,
          senderId
        }))
      }
      break

    case 'ice-candidate':
      // Forward ICE candidate to other participants
      room.participants.forEach((participant, id) => {
        if (id !== senderId && participant.ws.readyState === 1) {
          participant.ws.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: data.candidate,
            senderId
          }))
        }
      })
      break

    case 'ping':
      // Respond with pong for connection health check
      const sender = room.participants.get(senderId)
      if (sender && sender.ws.readyState === 1) {
        sender.ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now()
        }))
      }
      break

    default:
      logger.warn(`WebRTC: Unknown message type: ${data.type}`)
  }
}

// REST endpoints for room management
router.get('/rooms/:roomCode', (req, res) => {
  const { roomCode } = req.params
  const room = rooms.get(roomCode)
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' })
  }

  res.json({
    roomCode,
    participantCount: room.participants.size,
    participants: Array.from(room.participants.values()).map(p => ({
      userId: p.userId,
      userRole: p.userRole
    }))
  })
})

router.post('/rooms/:roomCode/join', (req, res) => {
  const { roomCode } = req.params
  const { userId, userRole } = req.body

  // Create room if it doesn't exist
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      participants: new Map(),
      offers: new Map(),
      answers: new Map(),
      iceCandidates: new Map()
    })
  }

  const room = rooms.get(roomCode)
  
  // Check if room is full (max 2 participants for telemedicine)
  if (room.participants.size >= 2) {
    return res.status(400).json({ error: 'Room is full' })
  }

  res.json({
    success: true,
    roomCode,
    participantCount: room.participants.size,
    canJoin: true
  })
})

router.delete('/rooms/:roomCode', (req, res) => {
  const { roomCode } = req.params
  
  if (rooms.has(roomCode)) {
    // Close all connections in the room
    const room = rooms.get(roomCode)
    room.participants.forEach((participant) => {
      if (participant.ws.readyState === 1) {
        participant.ws.close()
      }
    })
    rooms.delete(roomCode)
    logger.info(`WebRTC: Room ${roomCode} manually closed`)
  }

  res.json({ success: true })
})

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    activeRooms: rooms.size,
    activeConnections: connections.size,
    timestamp: new Date().toISOString()
  })
})

module.exports = router
