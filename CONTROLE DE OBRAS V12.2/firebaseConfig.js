// --- FIREBASE IMPORTS ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- FIREBASE CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyB4PRTEgOamRUd1Hk69dFtPWJn8CayEPJo",
    authDomain: "controle-obras-frinox.firebaseapp.com",
    projectId: "controle-obras-frinox",
    storageBucket: "controle-obras-frinox.firebasestorage.app",
    messagingSenderId: "125104743179",
    appId: "1:125104743179:web:c497fb5e5f92ae9671780e"
};

// --- FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- EXPORTS ---
export { db, auth };
