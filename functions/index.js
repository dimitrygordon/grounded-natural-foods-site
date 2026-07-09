/**
 * Grounded Natural Foods — auth management functions.
 * These run on Google's servers, never in a browser, which is what makes
 * role claims trustworthy: nothing here can be faked from client code.
 *
 * Usernames are mapped to synthetic emails (username@groundedmarket.com)
 * because Firebase Auth is email-based; staff never see or use the email.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
admin.initializeApp();

const EMAIL_DOMAIN = 'groundedmarket.com';
const toEmail = (username) => `${username.trim().toLowerCase().replace(/\s+/g, '')}@${EMAIL_DOMAIN}`;

function requireMaster(request){
  if (!request.auth || request.auth.token.role !== 'master') {
    throw new HttpsError('permission-denied', 'Only the master account can manage employee logins.');
  }
}

// Create a Firebase Auth login for a new employee.
// Called by the app right after master adds the employee's Firestore profile.
exports.createEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { username, password, employeeId } = request.data || {};
  if (!username || !password || !employeeId) throw new HttpsError('invalid-argument', 'username, password, and employeeId are required.');
  if (password.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters (Firebase requirement).');
  const user = await admin.auth().createUser({ email: toEmail(username), password });
  await admin.auth().setCustomUserClaims(user.uid, { role: 'employee', employeeId });
  await admin.firestore().collection('employees').doc(employeeId).set({ authUid: user.uid }, { merge: true });
  return { uid: user.uid };
});

// Update an employee's username and/or password, or enable/disable login.
exports.updateEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { employeeId, username, password, disabled } = request.data || {};
  if (!employeeId) throw new HttpsError('invalid-argument', 'employeeId is required.');
  const snap = await admin.firestore().collection('employees').doc(employeeId).get();
  const uid = snap.exists ? snap.data().authUid : null;
  if (!uid) throw new HttpsError('not-found', 'No auth account found for that employee — try Save again after re-adding them.');
  const update = {};
  if (username) update.email = toEmail(username);
  if (password) {
    if (password.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
    update.password = password;
  }
  if (typeof disabled === 'boolean') update.disabled = disabled;
  await admin.auth().updateUser(uid, update);
  return { ok: true };
});

// Delete an employee's login entirely (called when master deletes them).
exports.deleteEmployeeAuth = onCall(async (request) => {
  requireMaster(request);
  const { employeeId } = request.data || {};
  if (!employeeId) throw new HttpsError('invalid-argument', 'employeeId is required.');
  const snap = await admin.firestore().collection('employees').doc(employeeId).get();
  const uid = snap.exists ? snap.data().authUid : null;
  if (uid) await admin.auth().deleteUser(uid).catch(() => {});
  return { ok: true };
});
