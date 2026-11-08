"use client";
import {useEffect} from "react";
import {pageMarkup} from "../lib/page-markup";
export default function LaundryClient(){useEffect(()=>{const s=document.createElement("script");s.src="/app.js";s.async=true;document.body.appendChild(s);return ()=>{s.remove();};},[]);return <div dangerouslySetInnerHTML={{__html:pageMarkup}}/>;}
