.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000


-get jurisdiction documents based on adress
-extract real rules from pdf documents

-E:\ArchAI\archai\app\api\agents\[tool] in paths and naming is [tool] used for tool 1 "precheck" 
-ability to choose different objects/type values manually

-add copilot to dashboard
-add ability to crop screen to copilot

Active model persistence to DB: if you want the active model choice to survive across devices/browsers, add active_model_run_id uuid references precheck_runs(id) to the projects table and a server action to update it.
Tool-type tag on runs: when Tool 2+ is implemented, add a tool_type column to a future tool_runs table (or to precheck_runs) so ProjectRuns can group by tool.
RightPanel wiring in Precheck: PrecheckWorkspace currently renders its own right panel inline. A future pass could extract its Issues/Checklist/Run Details tabs into RightPanel and pass precheckContext from the precheck page — but the workspace is well-encapsulated and this refactor is not blocking.
Settings page: project rename/delete UI is a stub — needs a form with a server action.


-delete runs, documents and models in project overview