import { redirect } from 'next/navigation';

/** My attendance moved to its own section. */
export default function MyAttendanceMoved(): never {
  redirect('/attendance');
}
