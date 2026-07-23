import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router-dom";
import { UserPlus, User, Mail, Phone, Lock } from "lucide-react";
import "../styles/Register.css";
import { apiFetch } from '../../src/utils/api';

function Register() {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm();
    const [serverError, setServerError] = useState("");
    const [photoPreview, setPhotoPreview] = useState(null);
    const [photoBase64, setPhotoBase64] = useState(null);
    const navigate = useNavigate();

    const handlePhotoChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            setPhotoBase64(reader.result);
            setPhotoPreview(reader.result);
        };
        reader.readAsDataURL(file);
    };

    const onSubmit = async (data) => {
        setServerError("");
        try {
            const res = await fetch("http://localhost:5000/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: data.name,
                    email: data.email,
                    password: data.password,
                    phone: data.phone,
                    profile_picture: photoBase64,
                    role: "admin",
                }),
            });
            const result = await res.json();

            if (!res.ok) {
                setServerError(result.message || "Registration failed.");
                return;
            }

            navigate("/login");
        } catch (err) {
            setServerError("Could not reach server. Check it is running.");
            console.error(err);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-icon">
                    <UserPlus size={22} />
                </div>

                <h2 className="auth-heading">Create Account</h2>
                <p className="auth-subtext">
                    Already have an account? <Link to="/login">Login</Link>
                </p>

                <div className="photo-upload-block">
                    <div className="photo-preview">
                        {photoPreview ? (
                            <img src={photoPreview} alt="Profile preview" />
                        ) : (
                            <span className="photo-placeholder">?</span>
                        )}
                    </div>
                    <label className="photo-upload-label">
                        Upload Photo
                        <input type="file" accept="image/*" onChange={handlePhotoChange} hidden />
                    </label>
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="input-group">
                        <User size={16} className="input-icon" />
                        <input
                            type="text"
                            {...register("name", { required: true })}
                            placeholder="Full name"
                        />
                    </div>
                    {errors.name && <span className="field-error">*Name* is mandatory</span>}

                    <div className="input-group">
                        <Mail size={16} className="input-icon" />
                        <input
                            type="email"
                            {...register("email", { required: true })}
                            placeholder="Email address"
                        />
                    </div>
                    {errors.email && <span className="field-error">*Email* is mandatory</span>}

                    <div className="input-group">
                        <Phone size={16} className="input-icon" />
                        <input
                            type="tel"
                            {...register("phone")}
                            placeholder="Phone number (optional)"
                        />
                    </div>

                    <div className="input-group">
                        <Lock size={16} className="input-icon" />
                        <input
                            type="password"
                            {...register("password", { required: true })}
                            placeholder="Password"
                        />
                    </div>
                    {errors.password && <span className="field-error">*Password* is mandatory</span>}

                    {serverError && <span className="field-error">{serverError}</span>}

                    <input type="submit" className="auth-submit" value="Register" />
                </form>
            </div>
        </div>
    );
}

export default Register;