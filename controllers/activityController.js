const ActivityController = {
  async getClinicActivity(req, res) {
    // Placeholder: In a real implementation, fetch activity logs from DB
    const { id } = req.params;
    res.status(200).json({
      success: true,
      data: [
        { id: 1, type: 'appointment_created', message: `Appointment created for clinic ${id}`, timestamp: new Date().toISOString() },
        { id: 2, type: 'patient_registered', message: `New patient registered in clinic ${id}`, timestamp: new Date().toISOString() },
      ],
      message: 'This is mock activity data.'
    });
  }
};

module.exports = ActivityController;
