package smartport_m1m.m1.service;

import java.util.Map;

public class VoyageHttpException extends RuntimeException {
    private final int status;
    private final Map<String, Object> body;

    public VoyageHttpException(int status, Map<String, Object> body) {
        super("Node.js rejected the voyage request");
        this.status = status;
        this.body = body;
    }
    public int status() { return status; }
    public Map<String, Object> body() { return body; }
}
