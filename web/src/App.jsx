import { Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import IdleTimeoutWarning from './components/IdleTimeoutWarning.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Home from './pages/Home.jsx';
import Doctors from './pages/Doctors.jsx';
import DoctorProfile from './pages/DoctorProfile.jsx';
import Book from './pages/Book.jsx';
import Appointments from './pages/Appointments.jsx';
import AppointmentDetail from './pages/AppointmentDetail.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import AdminDoctors from './pages/admin/AdminDoctors.jsx';
import AdminNotifications from './pages/admin/AdminNotifications.jsx';
import DoctorQueue from './pages/DoctorQueue.jsx';
import DoctorAppointmentDetail from './pages/DoctorAppointmentDetail.jsx';

export default function App() {
  return (
    <>
      <Nav />
      <IdleTimeoutWarning />
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
          path="/appointments/:id"
          element={
            <RequireAuth roles={['patient', 'doctor']}>
              <AppointmentDetail />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/notifications"
          element={
            <RequireAuth roles={['admin']}>
              <AdminNotifications />
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
          path="/doctor"
          element={
            <RequireAuth roles={['doctor']}>
              <DoctorQueue />
            </RequireAuth>
          }
        />
        <Route
          path="/doctor/appointments/:id"
          element={
            <RequireAuth roles={['doctor']}>
              <DoctorAppointmentDetail />
            </RequireAuth>
          }
        />
      </Routes>
    </>
  );
}
