package smartport_m1m.m1.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import com.fasterxml.jackson.annotation.JsonAlias;

public record ReviewVesselDocumentRequest(
        @NotBlank(message = "Trang thai xet duyet khong duoc de trong")
        @Size(max = 20)
        String status,

        @Size(max = 1000)
        @JsonAlias("review_note") String reviewNote) {
}
