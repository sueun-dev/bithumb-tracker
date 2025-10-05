#!/bin/bash

# 프론트엔드 실행
cd frontend
npm run dev &

# 백엔드 실행
cd ../backend
npm start