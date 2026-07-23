import bcrypt from 'bcrypt';

const newPassword = 'Altai@maxxtech2026.my';
const hash = await bcrypt.hash(newPassword, 10);
console.log('Hash:', hash);

const check = await bcrypt.compare(newPassword, hash);
console.log('Self-check:', check);