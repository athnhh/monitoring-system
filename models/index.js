const mongoose = require('mongoose');

// Helper to handle $sort queries in find and findOne (keeps server.js controller code unchanged)
const handleQuerySort = function(next) {
  const query = this.getQuery();
  if (query && query.$sort) {
    this.sort(query.$sort);
    delete query.$sort;
  }
  next();
};

const schemaOptions = {
  timestamps: true,
  id: false // Disable virtual 'id' getter so that custom 'id' fields can be read normally
};

// Admin Schema
const AdminSchema = new mongoose.Schema({
  username: { type: String, required: true },
  password: { type: String, required: true },
  email: { type: String, required: true }
}, schemaOptions);

// Employee Schema
const EmployeeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  designation: { type: String },
  email: { type: String },
  phone: { type: String },
  bday: { type: String },
  joining: { type: String },
  password: { type: String, default: 'emp123' },
  cl: { type: Number, default: 7.5 },
  sl: { type: Number, default: 3.0 },
  ul: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  calendarEventId: { type: String },
  _lastAccrualMonth: { type: Number },
  _lastAccrualYear: { type: Number }
}, schemaOptions);

// Attendance Schema
const AttendanceSchema = new mongoose.Schema({
  id: { type: String, required: true }, // Employee ID
  name: { type: String, required: true },
  dept: { type: String, required: true },
  date: { type: String, required: true },
  in: { type: String },
  out: { type: String },
  hours: { type: Number, default: 0 },
  status: { type: String, default: 'Present' }
}, schemaOptions);

// Leave Request Schema
const LeaveRequestSchema = new mongoose.Schema({
  idx: { type: Number, required: true, unique: true },
  empId: { type: String, required: true },
  empName: { type: String, required: true },
  dept: { type: String, required: true },
  type: { type: String, required: true }, // CL, SL, UL
  from: { type: String, required: true },
  to: { type: String, required: true },
  days: { type: Number, required: true },
  reason: { type: String, required: true },
  status: { type: String, default: 'Pending' }
}, schemaOptions);

// Announcement Schema
const AnnouncementSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  date: { type: String, required: true },
  recipientType: { type: String },
  recipientValue: { type: String },
  priority: { type: String, default: 'normal' },
  body: { type: String, required: true }
}, schemaOptions);

// Notification Schema
const NotificationSchema = new mongoose.Schema({
  text: { type: String, required: true },
  time: { type: String },
  unread: { type: Boolean, default: true },
  target: { type: String, default: 'admin' },
  userId: { type: String }
}, schemaOptions);

// Password Reset Schema
const PasswordResetSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  tempPassword: { type: String, required: true },
  email: { type: String, required: true },
  expiresAt: { type: String, required: true }
}, schemaOptions);

// Department Schema
const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }
}, schemaOptions);

// Archived Employee Schema
const ArchivedEmployeeSchema = new mongoose.Schema({
  originalId: { type: String, required: true },
  id: { type: String },
  name: { type: String },
  dept: { type: String },
  status: { type: String },
  joining: { type: String },
  exit: { type: String },
  employeeData: { type: mongoose.Schema.Types.Mixed }
}, schemaOptions);

// System Config Schema
const SystemConfigSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
}, schemaOptions);

// Apply query middleware
const schemas = [
  AdminSchema, EmployeeSchema, AttendanceSchema, LeaveRequestSchema,
  AnnouncementSchema, NotificationSchema, PasswordResetSchema,
  DepartmentSchema, ArchivedEmployeeSchema, SystemConfigSchema
];

schemas.forEach(schema => {
  schema.pre('find', handleQuerySort);
  schema.pre('findOne', handleQuerySort);
});

// Compile models
const Admin = mongoose.models.Admin || mongoose.model('Admin', AdminSchema);
const Employee = mongoose.models.Employee || mongoose.model('Employee', EmployeeSchema);
const Attendance = mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);
const LeaveRequest = mongoose.models.LeaveRequest || mongoose.model('LeaveRequest', LeaveRequestSchema);
const Announcement = mongoose.models.Announcement || mongoose.model('Announcement', AnnouncementSchema);
const Notification = mongoose.models.Notification || mongoose.model('Notification', NotificationSchema);
const PasswordReset = mongoose.models.PasswordReset || mongoose.model('PasswordReset', PasswordResetSchema);
const Department = mongoose.models.Department || mongoose.model('Department', DepartmentSchema);
const ArchivedEmployee = mongoose.models.ArchivedEmployee || mongoose.model('ArchivedEmployee', ArchivedEmployeeSchema);
const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', SystemConfigSchema);

// Dummy initFirestore for compatibility
function initFirestore() {
  console.log('Firebase Firestore disabled, using Mongoose instead.');
}

module.exports = {
  Admin,
  Employee,
  Attendance,
  LeaveRequest,
  Announcement,
  Notification,
  PasswordReset,
  Department,
  ArchivedEmployee,
  SystemConfig,
  initFirestore
};
