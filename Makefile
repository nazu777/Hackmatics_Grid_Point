.PHONY: setup test run-backend run-frontend run-streamlit build-frontend

setup:
	@echo "Setting up Python backend environment..."
	uv venv backend/.venv
	uv pip install -r backend/requirements.txt --python backend/.venv/bin/python
	@echo "Setting up React frontend environment..."
	cd frontend && pnpm install

test:
	@echo "Running backend test suite..."
	backend/.venv/bin/pytest -c backend/pyproject.toml backend/tests -v

run-backend:
	@echo "Starting FastAPI backend server on http://localhost:8000..."
	backend/.venv/bin/uvicorn src.api:app --reload --port 8000 --app-dir backend

run-frontend:
	@echo "Starting React frontend development server on http://localhost:3000..."
	pnpm --prefix frontend dev

run-streamlit:
	@echo "Starting Streamlit dashboard on http://localhost:8501..."
	backend/.venv/bin/streamlit run app.py

build-frontend:
	@echo "Building React production assets..."
	pnpm --prefix frontend build
