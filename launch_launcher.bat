@echo off
echo Iniciando Lanzador Fonoster...

cd launcher

:: Start Backend in new window
start "Fonoster Backend" cmd /k "npm start"

:: Start Frontend in new window
start "Fonoster Frontend" cmd /k "npm run dev"

:: Wait a moment for dev server to spin up then open browser
timeout /t 5 >nul
start http://localhost:5173

exit
