const mongoose = require('mongoose');

const Schema = mongoose.Schema;

// ── Admin Schema ──
const adminSchema = new Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  email: { type: String, default: '' }
}, { timestamps: true });

// ── Employee Schema ──
const employeeSchema = new Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  dept: { type: String, required: true },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  bday: { type: String, default: '' },
  joining: { type: String, default: '' },
  designation: { type: String, default: '' },
  password: { type: String, default: 'emp123' },
  cl: { type: Number, default: 7.5 },
  sl: { type: Number, default: 3.0 },
  ul: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  calendarEventId: { type: String, default: '' }
}, { timestamps: true });

// ── Attendance Schema ──
const attendanceSchema = new Schema({
  id: { type: String, required: true },
  name: { type: String, default: '' },
  dept: { type: String, default: '' },
  date: { type: String, required: true },
  in: { type: String, default: '' },
  out: { type: String, default: '' },
  hours: { type: Number, default: 0 },
  status: { type: String, default: 'Present' }
}, { timestamps: true });

attendanceSchema.index({ id: 1, date: 1 }, { unique: true });

// ── LeaveRequest Schema ──
const leaveRequestSchema = new Schema({
  idx: { type: Number, default: 0 },
  empId: { type: String, default: '' },
  empName: { type: String, default: '' },
  dept: { type: String, default: '' },
  type: { type: String, default: 'CL' },
  from: { type: String, default: '' },
  to: { type: String, default: '' },
  days: { type: Number, default: 0 },
  reason: { type: String, default: '' },
  status: { type: String, default: 'Pending' }
}, { timestamps: true });

// ── Announcement Schema ──
const announcementSchema = new Schema({
  date: { type: String, default: '' },
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  by: { type: String, default: 'Admin' },
  priority: { type: String, default: 'normal' },
  recipient: { type: String, default: 'All Employees' }
}, { timestamps: true });

// ── Notification Schema ──
const notificationSchema = new Schema({
  text: { type: String, default: '' },
  time: { type: String, default: '' },
  unread: { type: Boolean, default: true },
  target: { type: String, default: 'admin' },
  userId: { type: String, default: '' }
}, { timestamps: true });

// ── PasswordReset Schema ──
const passwordResetSchema = new Schema({
  userId: { type: String, default: '' },
  otp: { type: String, default: '' },
  email: { type: String, default: '' },
  tempPassword: { type: String, default: '' },
  resetToken: { type: String, default: '' },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });

// ── Department Schema ──
const departmentSchema = new Schema({
  name: { type: String, required: true, unique: true }
}, { timestamps: true });

// ── ArchivedEmployee Schema ──
const archivedEmployeeSchema = new Schema({
  originalId: { type: String, default: '' },
  id: { type: String, default: '' },
  name: { type: String, default: '' },
  dept: { type: String, default: '' },
  status: { type: String, default: 'Archived' },
  joining: { type: String, default: '' },
  exit: { type: String, default: '' },
  employeeData: { type: Object, default: {} }
}, { timestamps: true });

// ── Export Models ──
const Admin = mongoose.model('Admin', adminSchema);
const Employee = mongoose.model('Employee', employeeSchema);
const Attendance = mongoose.model('Attendance', attendanceSchema);
const LeaveRequest = mongoose.model('LeaveRequest', leaveRequestSchema);
const Announcement = mongoose.model('Announcement', announcementSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
const Department = mongoose.model('Department', departmentSchema);
const ArchivedEmployee = mongoose.model('ArchivedEmployee', archivedEmployeeSchema);

module.exports = {
  Admin,
  Employee,
  Attendance,
  LeaveRequest,
  Announcement,
  Notification,
  PasswordReset,
  Department,
  ArchivedEmployee
};
