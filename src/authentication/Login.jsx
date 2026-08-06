import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { apiFetch } from '../../src/utils/api';
import { Mail, Lock } from "lucide-react";
import { setAuth } from "../utils/authStorage";
import logo from "../assets/logo.png";
import "../styles/LoginPage.css";

function Login() {
    const {
        register,
        handleSubmit,
        watch,
        formState: { errors },
    } = useForm();
    const [serverError, setServerError] = useState("");
    const [focusField, setFocusField] = useState("");
    const [revealPassword, setRevealPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();

    const emailValue = watch("email", "");
    const passwordValue = watch("password", "");
    const isValid = /.+@.+\..+/.test(emailValue || "") && (passwordValue || "").length >= 6;

    const onSubmit = async (data) => {
        setServerError("");
        setIsSubmitting(true);
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

            setAuth(result.token, result.user, rememberMe);

            if (result.user.role === "super_admin") {
                navigate("/superadmin/dashboard");
            } else {
                navigate("/dashboard");
            }
        } catch (err) {
            setServerError("Could not reach server. Check it is running.");
            console.error(err);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="al-page">
            <div className="al-wrap">
                {/* Row 1 + 2 + 3: logo, title, tagline */}
                <div className="al-brand">
                    <img src={logo} alt="Altai" className="al-brand-logo" />
                    <div className="al-brand-text">
                        <div className="al-brand-title">ALTAI QR Inventory</div>
                        <div className="al-brand-tagline">SCAN · TRACK · BALANCE</div>
                    </div>
                </div>

                {/* Login card */}
                <div className="al-card">
                    <form className="al-card-body" onSubmit={handleSubmit(onSubmit)} noValidate>
                        <div>
                            <div className="al-card-heading">Welcome back</div>
                            <div className="al-card-subtext">Sign in to your merchant workspace.</div>
                        </div>

                        <label className="al-field">
                            <span className="al-field-label">EMAIL ADDRESS</span>
                            <span className={`al-input-wrap ${focusField === "email" ? "al-input-wrap-focus" : ""}`}>
                                <Mail size={15} className="al-input-icon" />
                                <input
                                    type="email"
                                    placeholder="you@altaitech.my"
                                    onFocus={() => setFocusField("email")}
                                    onBlur={() => setFocusField("")}
                                    {...register("email", { required: true })}
                                />
                            </span>
                            {errors.email && <span className="al-field-error">Email is required</span>}
                        </label>

                        <label className="al-field">
                            <span className="al-field-label">PASSWORD</span>
                            <span className={`al-input-wrap ${focusField === "password" ? "al-input-wrap-focus" : ""}`}>
                                <Lock size={15} className="al-input-icon" />
                                <input
                                    type={revealPassword ? "text" : "password"}
                                    placeholder="••••••••"
                                    onFocus={() => setFocusField("password")}
                                    onBlur={() => setFocusField("")}
                                    {...register("password", { required: true })}
                                />
                                <button
                                    type="button"
                                    className="al-reveal-btn"
                                    onClick={() => setRevealPassword((prev) => !prev)}
                                >
                                    {revealPassword ? "Hide" : "Show"}
                                </button>
                            </span>
                            {errors.password && <span className="al-field-error">Password is required</span>}
                        </label>

                        <div className="al-remember-row">
                            <button
                                type="button"
                                className={`al-checkbox ${rememberMe ? "al-checkbox-checked" : ""}`}
                                onClick={() => setRememberMe((prev) => !prev)}
                                aria-label="Keep me signed in on this device"
                            >
                                {rememberMe ? "✓" : ""}
                            </button>
                            <span className="al-remember-label" onClick={() => setRememberMe((prev) => !prev)}>
                                Keep me signed in on this device
                            </span>
                        </div>

                        {serverError && <span className="al-field-error">{serverError}</span>}

                        <button type="submit" className="al-submit-btn" disabled={!isValid || isSubmitting}>
                            {isSubmitting ? "Signing in…" : "Sign in"}
                        </button>
                    </form>

                    <div className="al-status-bar">
                        <span className="al-status-dot" />
                        <span className="al-status-text">ALL SYSTEMS OPERATIONAL</span>
                        <span className="al-status-version">v1.0</span>
                    </div>
                </div>

                <div className="al-below-card">
                    <div className="al-sales-row">
                        <span>No merchant account?</span>
                        <a href="#">Talk to sales</a>
                    </div>
                    <div className="al-powered-by">POWERED BY MAXXTECH SYSTEMS SDN BHD</div>
                </div>
            </div>
        </div>
    );
}

export default Login;