import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { apiFetch } from '../../src/utils/api';
import { KeyRound, Mail, Lock } from "lucide-react";
import "../styles/Login.css";

function Login() {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm();
    const [serverError, setServerError] = useState("");
    const navigate = useNavigate();

    const onSubmit = async (data) => {
        setServerError("");
        try {
            const res = await apiFetch("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({ email: data.email, password: data.password }),
            });
            const result = await res.json();

            if (!res.ok) {
                setServerError(result.message || "Login failed.");
                return;
            }

            localStorage.setItem("authToken", result.token);
            localStorage.setItem("authUser", JSON.stringify(result.user));

            if (result.user.role === "super_admin") {
                navigate("/superadmin/dashboard");
            } else {
                navigate("/dashboard");
            }
        } catch (err) {
            setServerError("Could not reach server. Check it is running.");
            console.error(err);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-icon">
                    <KeyRound size={22} />
                </div>

                <h2 className="auth-heading">Welcome Back</h2>

                <form onSubmit={handleSubmit(onSubmit)}>
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
                        <Lock size={16} className="input-icon" />
                        <input
                            type="password"
                            {...register("password", { required: true })}
                            placeholder="Password"
                        />
                    </div>
                    {errors.password && <span className="field-error">*Password* is mandatory</span>}

                    {serverError && <span className="field-error">{serverError}</span>}

                    <input type="submit" className="auth-submit" value="Login" />
                </form>
            </div>
        </div>
    );
}

export default Login;