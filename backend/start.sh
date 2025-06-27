#!/bin/bash
gunicorn backend.main:app --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT