package smartport_m1m.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class VesselDocumentApiClientTest {

    @Test
    void uploadSendsMultipartFieldsFilenameAndUnchangedBytes() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        byte[] bytes = "%PDF-1.7\nexact-file-bytes".getBytes(StandardCharsets.US_ASCII);
        ByteArrayResource resource = new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return "ship.pdf";
            }
        };

        server.expect(requestTo("http://node.test/api/ships/42/documents"))
                .andExpect(method(org.springframework.http.HttpMethod.POST))
                .andExpect(content().contentTypeCompatibleWith(MediaType.MULTIPART_FORM_DATA))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("name=\"document_type\"")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("name=\"file\"; filename=\"ship.pdf\"")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("%PDF-1.7\nexact-file-bytes")))
                .andRespond(withSuccess("{\"success\":true,\"data\":{\"id\":12}}", MediaType.APPLICATION_JSON));

        VesselDocumentApiClient client = new VesselDocumentApiClient("http://node.test", builder);
        assertTrue(Boolean.TRUE.equals(client.upload(42, "Registry", resource,
                "ship.pdf", MediaType.APPLICATION_PDF).get("success")));
        server.verify();
    }
}
