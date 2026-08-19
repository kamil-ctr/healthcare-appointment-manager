import { Routes, Route } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';
import Nav from './components/Nav.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Home from './pages/Home.jsx';
import Doctors from './pages/Doctors.jsx';
import DoctorProfile from './pages/DoctorProfile.jsx';
import Book from './pages/Book.jsx';
import Appointments from './pages/Appointments.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import AdminDoctors from './pages/admin/AdminDoctors.jsx';

function DoctorPortalPlaceholder() {
  const { auth } = useAuth();
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <h1 className="mb-2 text-2xl">Welcome, {auth.user.fullName}</h1>
      <p className="text-ink/60">The doctor portal isn't built yet.</p>
    </main>
  );
}

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/doctors"
          element={
            <RequireAuth>
              <Doctors />
            </RequireAuth>
          }
        />
        <Route
          path="/doctors/:id"
          element={
            <RequireAuth>
              <DoctorProfile />
            </RequireAuth>
          }
        />
        <Route
          path="/book/:doctorId"
          element={
            <RequireAuth roles={['patient']}>
              <Book />
            </RequireAuth>
          }
        />
        <Route
          path="/appointments"
          element={
            <RequireAuth roles={['patient', 'doctor']}>
              <Appointments />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/*"
          element={
            <RequireAuth roles={['admin']}>
              <AdminDoctors />
            </RequireAuth>
          }
        />
        <Route
          path="/doctor-portal"
          element={
            <RequireAuth roles={['doctor']}>
              <DoctorPortalPlaceholder />
            </RequireAuth>
          }
        />
      </Routes>
    </>
  );
}
