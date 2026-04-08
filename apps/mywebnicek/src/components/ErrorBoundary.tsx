import { Button, Card, CardHeader, Text, Title3 } from "@fluentui/react-components";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * Error boundary component to catch React rendering errors
 * and prevent the entire app from crashing.
 */
export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    override render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    minHeight: "200px",
                    padding: 20
                }}>
                    <Card style={{ maxWidth: 500, padding: 20 }}>
                        <CardHeader
                            image={<span style={{ color: "#d13438", fontSize: 32 }}>⚠</span>}
                            header={<Title3>Something went wrong</Title3>}
                        />
                        <div style={{ marginTop: 12, marginBottom: 16 }}>
                            <Text style={{ color: "#605e5c" }}>
                                {this.state.error?.message || "An unexpected error occurred"}
                            </Text>
                            {this.state.error?.message?.includes("tag name") && (
                                <Text block style={{ marginTop: 8, color: "#605e5c" }}>
                                    Tip: Tag names should be valid HTML tags like "div", "span", "input" (without angle brackets).
                                </Text>
                            )}
                        </div>
                        <Button appearance="primary" onClick={this.handleReset}>
                            Try Again
                        </Button>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
