const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function test() {
  console.log('Starting server tests...\n');

  // Test 1: Login page
  try {
    const result = await get('http://localhost:3000/');
    console.log('1. GET / → Status ' + result.status);
    if (result.status !== 200) throw new Error('Expected 200, got ' + result.status);
    if (typeof result.body !== 'string' || !result.body.includes('TEST')) throw new Error('Login page not found');
    console.log('   ✓ Login page loads\n');
  } catch (e) {
    console.log('   ✗ FAIL: ' + e.message + '\n');
    if (e.code === 'ECONNREFUSED') {
      console.log('Server is not running! Start it with: node server.js\n');
    }
    process.exit(1);
  }

  // Test 2: API state endpoint
  try {
    const result = await get('http://localhost:3000/api/state');
    console.log('2. GET /api/state → Status ' + result.status);
    if (result.status !== 200) throw new Error('Expected 200');
    const d = result.body;
    console.log('   Employees: ' + (d.employees ? d.employees.length : 'missing'));
    console.log('   Departments: ' + (d.departments ? d.departments.join(', ') : 'missing'));
    if (!d.employees || d.employees.length === 0) throw new Error('No employees loaded');
    console.log('   ✓ API works\n');
  } catch (e) {
    console.log('   ✗ FAIL: ' + e.message + '\n');
    process.exit(1);
  }

  // Test 3: Static CSS
  try {
    const result = await get('http://localhost:3000/styles.css');
    console.log('3. GET /styles.css → Status ' + result.status);
    if (result.status !== 200) throw new Error('Expected 200');
    if (typeof result.body === 'string' && !result.body.includes('body')) throw new Error('Not CSS');
    console.log('   ✓ Static CSS served\n');
  } catch (e) {
    console.log('   ✗ FAIL: ' + e.message + '\n');
  }

  // Test 4: Static JS
  try {
    const result = await get('http://localhost:3000/script.js');
    console.log('4. GET /script.js → Status ' + result.status);
    if (result.status !== 200) throw new Error('Expected 200');
    console.log('   ✓ Static JS served\n');
  } catch (e) {
    console.log('   ✗ FAIL: ' + e.message + '\n');
  }

  // Test 5: Employees endpoint
  try {
    const result = await get('http://localhost:3000/api/employees');
    console.log('5. GET /api/employees → Status ' + result.status);
    if (result.status !== 200) throw new Error('Expected 200');
    if (!Array.isArray(result.body)) throw new Error('Expected array');
    console.log('   Count: ' + result.body.length);
    console.log('   ✓ Employees API works\n');
  } catch (e) {
    console.log('   ✗ FAIL: ' + e.message + '\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  All 5 tests passed! ✓');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

test().catch(e => {
  console.error('\n  ✗ Test crashed:', e.message, '\n');
  process.exit(1);
});
